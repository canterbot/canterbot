
var EventEmitter = require('events').EventEmitter;
var request = require('request');
var _ = require('lodash');

var events = require('./events.js');

var sentiment = require('sentiment');

// voting settings
var PERIOD = 5; // time for the vote to be open, in minutes
var PERIOD_JITTER = 0.2; // fraction of period that is random
var MIN_VOTES = 3; // minimum number of votes for a decision to be made
var REQUIRED_SUPERMAJORITY = 0.65;
var MINUTE = 60 * 1000; // (one minute in ms)
var POLL_INTERVAL = MINUTE * 3; // how often to check the open pull requests (in seconds)

var decideVoteResult = function(yeas, nays) {
  // vote passes if yeas > nays
  return (yeas / (yeas + nays)) > REQUIRED_SUPERMAJORITY;
};

var voteStartedComment = '#### :ballot_box_with_check: Voting procedure reminder:\n' +
  'To cast a vote, post a comment containing `:+1:` (:+1:), or `:-1:` (:-1:).\n' +
  'Remember, you **must :star:star this repo for your vote to count.**\n\n' +
  'All comments within this discussion are searched for votes, regardless of the time of posting.\n' +
  'You can cast as many votes as you want, but only the last one will be counted.\n' +
  '(You may consider editing your comment instead of adding a new one.)\n' +
  'Comments containing both up- and down-votes are disregarded.\n' +
  'Pull request authors automatically count as a :+1: vote.\n\n' +
  'A decision will be made after this pull request has been open for **'+PERIOD+'** ' +
  'minutes (plus/minus **' + (PERIOD_JITTER*100) + '** percent, to avoid people timing their votes), ' +
  'and at least **'+MIN_VOTES+'** votes have been made.\n' +
  'A supermajority of **' + (REQUIRED_SUPERMAJORITY * 100) + '%** is required for the vote to pass.\n\n' +
  '*NOTE: the pull request will be closed if any new commits are added after:* ';

var modifiedWarning = '#### :warning: This pull request has been modified and is now being closed.\n\n' +
  'To prevent people from sneaking in changes after votes have been made, pull ' +
  'requests can\'t be committed on after they have been opened. Feel free to ' +
  'open a new pull request for the proposed changes to start another round of voting.';

var couldntMergeWarning = '#### :warning: Error: This pull request could not be merged\n\n' +
  'The changes in this pull request conflict with other changes, so we couldn\'t automatically merge it. ' +
  'You can fix the conflicts and submit the changes in a new pull request to start the voting process again.';

var kitten = '';

var votePassComment = ':+1: The vote passed! This pull request will now be merged into master.';
var voteFailComment = ':-1: The vote failed. This pull request will now be closed. Why don\'t you try some ideas that don\'t suck next time, you incredible git?';


// We add a jitter to the PERIOD after the comment has been created, "to avoid people timing their votes".
// More precisely, there is an incentive in the previous constant-period system to send in the vote at the last second,
// because otherwise people can "react" to it by voting in the opposite direction (with our without sock-puppet accounts).
PERIOD = PERIOD * (1 + (Math.random() - 0.5) * PERIOD_JITTER);

var voteEndComment = function(pass, yea, nay, nonStarGazers) {
  var total = yea + nay;
  var yeaPercent = percent(yea / total);
  var nayPercent = percent(nay / total);

  var resp = '#### ' + (pass ? (kitten + votePassComment) : voteFailComment) + '\n\n' +
    '----\n' +
    '**Tallies:**\n' +
    ':+1:: ' + yea + ' (' + yeaPercent + '%) \n' +
    ':-1:: ' + nay + ' (' + nayPercent + '%)';
  if (nonStarGazers.length > 0) {
    resp += "\n\n";
    resp += "These users aren't stargazers, so their votes were not counted: \n";
    nonStarGazers.forEach(function(user) {
      resp += " * @" + user + "\n";
    });
  }
  return resp;
};

var votesPerPullRequest = {};
var cachedStarGazers = {};
var cachedPullRequests = {};

function percent(n) { return Math.floor(n * 1000) / 10; }
function noop(err) {
  if(err) console.error(err);
}

// Export this module as a function
// (so we can pass it the config and Github client)
module.exports = function(config, gh, Twitter) {
  // the value returned by this module
  var voting = new EventEmitter();

  // an index of pull requests we have posted a 'vote started' comment on
  var started = {};

  // get a random kitten to be used by this instance of the bot
  var options = {
    hostname: 'thecatapi.com',
    port: 80,
    path: '/api/images/get?format=html',
    method: 'POST'
  };
  var req = require('http').request(options, function(res) {
    res.setEncoding('utf8');
    res.on('data', function(chunk) {
      kitten += chunk;
    });
  });
  req.write('');
  req.end();

  // handles an open pull request
  function handlePullRequest(pullreq) {
    console.log('');
    // Don't act on closed pull requests
    if (pullreq.state === 'closed') {
      return console.log('Update triggered on closed pull request #' + pullreq.number);
    }

    // if there is no 'vote started' comment, post one
    if(!started[pullreq.number]) {
      postVoteStarted(pullreq);
    }

    // TODO: instead of closing pull requests that get changed, just post a warning that
    //       votes have been reset, and only count votes that happen after the
    //       last change
    assertNotModified(pullreq, function() {
      // if the age of the pull request is >= the voting period, count the votes
      var age = Date.now() - new Date(pullreq.created_at).getTime();

      if(age / MINUTE >= PERIOD) {
        processPullRequest(pullreq);
      }
    });
  }

  // posts a comment explaining that the vote has started
  // (if one isn't already posted)
  function postVoteStarted(pullreq) {
    console.log('TRACE: postVoteStarted');
    getVoteStartedComment(pullreq, function(err, comment) {
      if(err) return console.error('error in postVoteStarted:', err);
      if(comment) {
        // we already posted the comment
        started[pullreq.number] = true;
        return;
      }

      gh.issues.createComment({
        user: config.user,
        repo: config.repo,
        number: pullreq.number,
        body: voteStartedComment + pullreq.head.sha

      }, function(err, res) {
        if(err) return console.error('error in postVoteStarted:', err);
        started[pullreq.number] = true;
        console.log('Posted a "vote started" comment for pull request #' + pullreq.number);

        // Tweet vote started
        Twitter.postTweet('Vote started for pull request #' + pullreq.number + ': https://github.com/canterbot/canterbot/pull/' + pullreq.number);

        // determine whether I like this pull request or not
        var score = sentiment(pullreq.title + ' ' + pullreq.body).score;
        if (score > 1) {
          // I like this pull request, let's vote for it!
          gh.issues.createComment({
            user: config.user,
            repo: config.repo,
            number: pullreq.number,
            body: ':+1:'
          });
        } else if (score < -1) {
          // Ugh, this pull request sucks, boooo!
          gh.issues.createComment({
            user: config.user,
            repo: config.repo,
            number: pullreq.number,
            body: ':-1:'
          });
        } // otherwise it's meh, so I don't care
      });
    });
  }

  // checks for a "vote started" comment posted by ourself
  // returns the comment if found
  function getVoteStartedComment(pullreq, cb) {
    console.log('TRACE: getVoteStartedComment');
    for(var i = 0; i < pullreq.comments.length; i++) {
      var postedByMe = pullreq.comments[i].user.login === config.user;
      var isVoteStarted = pullreq.comments[i].body.indexOf(voteStartedComment) === 0;
      if(postedByMe && isVoteStarted) {
        // comment was found
        return cb(null, pullreq.comments[i]);
      }
    }

    // comment wasn't found
    return cb(null, null);
  }

  // calls cb if the pull request has not been committed to since the voting started,
  // otherwise displays an error
  function assertNotModified(pullreq, cb) {
    console.log('TRACE: assertNotModified');
    getVoteStartedComment(pullreq, function(err, comment) {
      if(err) return console.error('error in assertNotModified:', err);

      if(comment) {
        var originalHead = comment.body.substr(comment.body.lastIndexOf(' ')+1);
        if(pullreq.head.sha !== originalHead) {
          console.log('Posting a "modified pull request" warning, and closing #' + pullreq.number);
          return closePullRequest(modifiedWarning, pullreq, noop);
        }
      }

      cb();
    });
  }

  // returns an object of all the people who have starred the repo, indexed by username
  function getStargazerIndex(cb) {
    console.log('TRACE: getStargazerIndex');
    getAllPages(gh.repos.getStargazers, function(err, stargazers) {
      if (err || !stargazers) {
        console.error('Error getting stargazers:', err);
        if (typeof cb === 'function') { return cb(err, stargazers); }
        return;
      }

      var index = {};
      stargazers.forEach(function(stargazer) {
        index[stargazer.login] = true;
      });
      cachedStarGazers = index;
      if (typeof cb === 'function') { cb(stargazers); }
    });
  }
  setInterval(getStargazerIndex, POLL_INTERVAL);

  // returns all results of a paginated function
  function getAllPages(pullreq, f, cb, n, results) {
    console.log('TRACE: getAllPages');
    // pull request is optional
    if(typeof pullreq === 'function') {
      cb = f;
      f = pullreq;
      pullreq = null;
    }
    if(!results) results = [];
    if(!n) n = 0;

    f({
      user: config.user,
      repo: config.repo,
      number: pullreq ? pullreq.number : null,
      page: n,
      per_page: 100

    }, function(err, res) {
      if(err || !res) return cb(err);

      results = results.concat(res);

      // if we got to the end of the results, return them
      if(res.length < 100) {
        return cb(null, results);
      }

      // otherwise keep getting more pages recursively
      getAllPages(pullreq, f, cb, n+1, results);
    });
  }

  // closes the pull request. if `message` is provided, it will be posted as a comment
  function closePullRequest(message, pullreq, cb) {
    console.log('TRACE: closePullRequest');
    // message is optional
    if(typeof pullreq === 'function') {
      cb = pullreq;
      pullreq = message;
      message = '';
    }

    // Flag the pull request as closed pre-emptively to prevent multiple comments.
    cachedPullRequests[pullreq.number].state = 'closed';

    if(message) {
      gh.issues.createComment({
        user: config.user,
        repo: config.repo,
        number: pullreq.number,
        body: message
      }, noop);
    }

    gh.pullRequests.update({
      user: config.user,
      repo: config.repo,
      number: pullreq.number,
      state: 'closed',
      title: pullreq.title,
      body: pullreq.body

    }, function(err, res) {
      if(err) return cb(err);
      voting.emit('close', pullreq);
      console.log('Closed pull request #' + pullreq.number);

      // Tweet pull request closed
      Twitter.postTweet('pull request #' + pullreq.number + ' has been closed: https://github.com/canterbot/canterbot/pull/' + pullreq.number);

      return cb(null, res);
    });
  }

  // merges a pull request into master. If it can't be merged, a warning is posted and the pull request is closed.
  function mergePullRequest(pullreq, cb) {
    console.log('TRACE: mergePullRequest');
    gh.pullRequests.get({
      user: config.user,
      repo: config.repo,
      number: pullreq.number

    }, function(err, res) {
      if(err || !res) return cb(err);
      if(res.mergeable === false) {
        console.error('Attempted to merge pull request #' + res.number +
                      ' but it failed with a mergeable (' + res.mergeable +
                      ') state of ' + res.mergeable_state);
        return closePullRequest(couldntMergeWarning, pullreq, function() {
          cb(new Error('Could not merge pull request because the author of the pull request is a smeghead.'));
        });
      } else if (res.mergeable === null) {
        console.error('Attempted to merge pull request #' + res.number +
                      ' but it was postponed with a mergeable (' +
                      res.mergeable + ') state of ' + res.mergeable_state);
        // Try it again in 5 seconds if it failed with a "null" mergeable state.
        return setTimeout(function () { mergePullRequest(pullreq, cb); }, 5000);
      }

      // Flag the pull request as closed pre-emptively to prevent multiple comments.
      cachedPullRequests[pullreq.number].state = 'closed';

      gh.pullRequests.merge({
        user: config.user,
        repo: config.repo,
        number: pullreq.number
      }, function(err, res) {
        if(!err){ 
          voting.emit('merge', pullreq);
          
          // Tweet pull request merged
          Twitter.postTweet('I now have the ability to ' + pullreq.title +
            ' https://github.com/canterbot/canterbot/pull/' + pullreq.number);
        }
        cb(err, res);
      });
    });
  }

  /**
   * Fetch all pull requests from GitHub, and then look up all of their comments.
   */
  function refreshAllPullRequests() {
    console.log('TRACE: refreshAllPullRequests');
    getAllPages(gh.pullRequests.getAll, function (err, pullreqs) {
      if (err || !pullreqs) {
        return console.error('Error getting Pull Requests.', err);
      }

      pullreqs.map(function (pullreq) {
        pullreq.comments = [];
        cachedPullRequests[pullreq.number] = pullreq;
        refreshAllComments(pullreq, handlePullRequest);
      });
    });
  }
  // Repoll all pull requests every 30 minutes, just to be safe.
  setInterval(refreshAllPullRequests, MINUTE * 30);

  /**
   * Fetch all comments for a pull request from GitHub.
   */
  function refreshAllComments(pullreq, cb) {
    console.log('TRACE: refreshAllComments');
    getAllPages(pullreq, gh.issues.getComments, function(err, comments) {
      if (err || !comments) {
        return console.error('Error getting Comments.', err);
      }

      pullreq.comments = comments;
      if (typeof cb === 'function') { cb(pullreq); }
    });
  }

  /**
   * Tally all of the votes for a pull request, and if conditions pass, merge or close it.
   */
  function processPullRequest(pullreq) {
    console.log('TRACE: processPullRequest');
    var voteResults = tallyVotes(pullreq);
    // only make a decision if we have the minimum amount of votes
    console.log('only make a decision if we have the minimum amount of votes');
    console.log('voteResults.total = ' + voteResults.total);
    console.log('MIN_VOTES = ' + MIN_VOTES);
    if (voteResults.total < MIN_VOTES) return;

    // vote passes if yeas > nays
    var passes = decideVoteResult(voteResults.positive, voteResults.negative);

    gh.issues.createComment({
      user: config.user,
      repo: config.repo,
      number: pullreq.number,
      body: voteEndComment(passes, voteResults.positive, voteResults.negative, voteResults.nonStarGazers)
    }, noop);

    if(passes) {
      mergePullRequest(pullreq, noop);
    } else {
      closePullRequest(pullreq, noop);
    }
  }

  /**
   * Tally up the votes on a pull request, and monitor which users are stargazers.
   */
  function tallyVotes(pullreq) {
    console.log('TRACE: tallyVotes');
    var tally = pullreq.comments.reduce(function (result, comment) {
      var user = comment.user.login,
          body = comment.body;

      // Don't check comments from the config user.
      if(user === config.user) return result;
      // People that don't star the repo cannot vote.
      if(!cachedStarGazers[user]) {
        result.nonStarGazers.push(user);
        return result; 
      }

      // Skip people who vote both ways.
      var voteCast = calculateUserVote(body);
      if (voteCast === null) { return result; }

      result.votes[user] = voteCast;

      return result;
    }, {
      votes: {},
      nonStarGazers: [],
    });

    // Add the pull request author as a positive vote.
    tally.votes[pullreq.user.login] = true;

    // determine whether I like this pull request or not (or don't care)
    var score = sentiment(pullreq.title + ' ' + pullreq.body).score;
    if (score > 1) {
      tally.votes[config.user] = true;
    } else if (score < -1) {
      tally.votes[config.user] = false;
    }

    var tallySpread = Object.keys(tally.votes).reduce(function (result, user) {
      // Increment the positive/negative counters.
      if(tally.votes[user]) {
          result.positive++;
      } else {
          result.negative++;
      }

      result.total++;
      return result;
    }, {
      positive: 0,
      negative: 0,
      total: 0
    });

    tallySpread.percentPositive = percent(tallySpread.positive / tallySpread.total);
    tallySpread.percentNegative = percent(tallySpread.negative / tallySpread.total);

    _.merge(tally, tallySpread);

    // Store this so that we can eventually make a votes webserver endpoint.
    votesPerPullRequest[pullreq.number] = tally;

    return tally;
  }

  /**
   * Check the text of a comment, and determine what vote was cast.
   */
  function calculateUserVote(text) {
    console.log('TRACE: calculateUserVote');
    var positive = (text.indexOf(':+1:') !== -1),
        negative = (text.indexOf(':-1:') !== -1);

    // If the user has voted positive and negative, or hasn't voted, ignore it.
    if (positive && negative) { return null; }
    if (!positive && !negative) { return null; }

    // If positive is true, its positive. If its false, they voted negative.
    return positive;
  }

  /**
   * When a pull request is opened, add it to the cache and handle it.
   */
  events.on('github.pull_request.opened', function (data) {
    console.log('EVENT: [file=voting.js] github.pull_request.opened');
    data.pull_request.comments = [];
    cachedPullRequests[data.number] = data.pull_request;
    handlePullRequest(data.pull_request);
  });

  /**
   * When a pull request is closed, mark it so we don't process it again.
   */
  events.on('github.pull_request.closed', function (data) {
    console.log('EVENT: [file=voting.js] github.pull_request.closed');
    var pullreq = cachedPullRequests[data.number];
    if (typeof pullreq !== 'undefined') {
      pullreq.state = 'closed';
    }
  });

  /**
   * When a comment is created, push it onto the pull request, and handle the pull request again.
   */
  events.on('github.comment.created', function (data) {
    console.log('EVENT: [file=voting.js] github.comment.created');
    var pullreq = cachedPullRequests[data.issue.number];
    if (typeof pullreq === 'undefined') {
      return console.error('Could not find pull request', data.issue.number, 'when adding a comment');
    }
    pullreq.comments.push(data.comment);
    handlePullRequest(pullreq);
  });

  /**
   * Initialize the voting system by polling stargazers, and then fetching pull
   * requests.
   */
  voting.initialize = function () {
    getStargazerIndex(refreshAllPullRequests);

    // If we're not set up for GitHub Webhooks, poll the server every interval.
    if (typeof config.githubAuth === 'undefined') {
      setInterval(refreshAllPullRequests, POLL_INTERVAL);
    }
  };

  return voting;
};
