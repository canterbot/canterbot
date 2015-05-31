var config = require('./config.js');
var Twitter = require('./lib/twitter.js');
var git = require('gift');
var Github = require('github');
var path = require('path');
var spawn = require('child_process').spawn;

var events = require('./lib/events.js');

var gh = new Github({
  version: '3.0.0',
  headers: {
    'User-Agent': config.user+'/'+config.repo
  }
});
gh.authenticate(config.githubAuth);

var voting = require('./lib/voting.js')(config, gh, Twitter, events);
var webserver = require('./lib/webserver.js')(config, events);

// if we merge something, `git sync` the changes and start the new version
voting.on('merge', function(pullreq) {
  console.log('EVENT: [file=main.js] merge');
  sync(function(err) {
    if(err) return console.error('error pulling from origin/master:', err);

    // Install the latest NPM packages and then restart.
    restart();
  });
});

// `git sync`
function sync(cb) {
  console.log('TRACE: [file=main.js] sync');
  var repo = git(__dirname);
  repo.sync(cb);
}

// gets the hash of the HEAD commit
function head(cb) {
  console.log('TRACE: [file=main.js] head');
  var repo = git(__dirname);
  repo.branch(function(err, head) {
    if(err) return cb(err);
    cb(null, head.commit.id);
  });
}

// starts ourself up in a new process, and kills the current one
function restart() {
  console.log('TRACE: [file=main.js] restart');
  var child = spawn('node', [__dirname + "/launcher.js"], {
    detached: true,
    stdio: 'inherit'
  });
  child.unref();

  // TODO: ensure child is alive before terminating self
  process.exit(0);
}

function considerExistence() {
  console.log('TRACE: [file=main.js] considerExistence');
  return undefined;
}

function main() {
  console.log('TRACE: [file=main.js] main');
  // find the hash of the current HEAD
  console.log('find the hash of the current HEAD');
  head(function(err, initial) {
    if(err) return console.error('error checking HEAD:', err);

    // make sure we are in sync with the remote repo
    console.log('make sure we are in sync with the remote repo');
    sync(function(err) {
      if(err) return console.error('error pulling from origin/master:', err);

      head(function(err, current) {
        if(err) return console.error('error checking HEAD:', err);

        // if we just got a new version, upgrade npm packages and restart
        console.log('if we just got a new version, upgrade npm packages and restart');
        if(initial !== current) return restart();

        console.log('Bot is initialized. HEAD:', current);
        considerExistence();

        // allow the voting system to bootstrap and begin monitoring pull requests
        console.log('allow the voting system to bootstrap and begin monitoring pull requests');
        voting.initialize();
      });
    });
  });
}
main();

process.on('uncaughtException', function(err) {
  console.error('UNCAUGHT ERROR: ' + err);
});
