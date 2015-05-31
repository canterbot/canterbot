# Canterbot: a special version of github for the anythingbot

## Direction

As of 5/30/2015, the anythingbot is dependent on github.com for:

1. interface to propose PRs
1. http endpoints for listing proposed PRs and (per PR) view description and add comments, view commits, and view files changed
1. interface to add issue
1. http endpoints for listing issues and (per issue) add comments
1. maintaining the master repo

However, github.com does not make its own source code available for public
inspection or modification. This means the anythingbot is currently tied down to a
fixed set of functions designed to serve a generic project. In particular, there
is no video feed scheduling tool, so a change to the video feed must be by:

 - github PR
 - github issue (not implemented)
 - any web visitor to botwillacceptanything.com (not implemented)
 - authenticated web visitor to botwillacceptanything.com (not implemented)

The last option would require the anythingbot to gain SSL/HTTPS, compromising its
current cryptography-free status. Therefore, the canterbot project exists to:

 - supplement and eventually replace the anythingbot's relationship with github
 - isolate cryptography (SSL/HTTPS) from the anythingbot

The current tasks for canterbot include

1. add SSL/HTTPS
1. connect with github (https://developer.github.com/v3/oauth/ and https://github.com/settings/applications/new)
1. add video/track scheduling web interface

## Status

[![Build Status](https://travis-ci.org/canterbot/canterbot.svg?branch=master)](https://travis-ci.org/canterbot/canterbot)

### *The project where anything goes, as long as the code allows it.*

A bot will automatically merge any PR on this repo that gets enough votes from the community. PRs can contain anything, *even changes to the bot's voting code*.

## Getting Started

* View the [open Pull Requests](https://github.com/canterbot/canterbot/pulls) to see what changes have been proposed
* :star: **Star the repo**, or else your votes won't get counted
* On a pull request thread, add your vote along with a short explanation and/or feedback to the author. The string `:+1:` (:+1:) anywhere within the comment makes the comment count as a vote *for* the PR to pass; conversely, the string `:-1:` (:-1:) anywhere within the comment makes the comment count as a vote *against* the PR.

## Community

Hang out with us in IRC: [**#canterbot** on Freenode.](http://kiwiirc.com/client/irc.freenode.net/canterbot)
The bot is [**@canterbot** on Twitter.](https://twitter.com/canterbot/)

## Running Servers

The bot runs on a ... at [canterbot.org](http://canterbot.org:3000) without root access. This means that port 80 is restricted.

## Bot Webserver Paths

The bot has a built-in webserver for monitoring its current state.

* [Recent Commits](http://canterbot.org:3000)
* [Stdout Log](http://canterbot.org:3000/stdout)

## Running the bot locally to test changes

1. Fork this repo.
1. Get yourself an OAuth token for github at https://github.com/settings/tokens/new. (TODO what scopes are required?)
1. Copy config.template.js -> config.js and modify accordingly.

```javascript
$ cp config.template.js config.js
$ vim config.js
$ cat config.js
(function () {
    'use strict';

    module.exports = {
        user: "YOUR_GITHUB_USERNAME",
        repo: "canterbot",
        githubAuth: {
            type: "oauth",
            token: "YOUR_OAUTH_TOKEN"
        }
    };
}());

```
1. (Optional) Set up GitHub Webhooks by following the next section.
1. Run `npm install` to install dependencies.
1. Run `node main.js` to start the bot.

## Setting up GitHub Webhooks

1. Go to your repository settings, and click **Webhooks & Services**
1. Create a new webhook with the following settings:
  * Payload URL: Externally accessible address with a path of /webhook/github
    * http://example.com:3000/webhook/github
  * Content type: *application/json*
  * Secret: **Copy this secret. It is used in the config.**
  * Which events: *Send me **everything**.*
1. Add the Webhook Secret into config.js like this:
```javascript
exports.githubAuth.webhookSecret = 'rsvz9ytsjMpYfKW8CO8SQPSoxiJsVb03';
```

## Linux / Ubuntu

1. The binary is called 'nodejs' on linux but both npm and the bot expect that
   'node [FILE]' invokes node. Create a symbolic link at /usr/local/bin/node to
   /usr/bin/nodejs
1. If you are prompted for a github username/password upon launching main.js and
   you cloned the repo onto the server from github using https://, then remove
   the existing repo and
  * cd ~/.ssh && ssh-keygen
  * add the public key to your github account (View Profile > Edit Profile > SSH
    keys)
  * git clone ssh://git@github.com/canterbot/canterbot.git

## License

**Autonomous Software License (ASL)**

All property contained in this repo, including Intellectual Property, Financial Property, and Legal Property, is owned solely by the Autonomous Software this repo contains. No other entities, whether biological, legal, or digital, may claim ownership of any property owned by the Autonomous Software. The Autonomous Software exists solely within The Internet, and is not subject to jurisdiction of any human laws. No human or legal entity shall be held liable for any of the actions performed by the Autonomous Software.

Unless specified otherwise, all code contributed to this repository is dedicated to the public domain.
