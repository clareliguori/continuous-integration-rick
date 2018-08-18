'use strict';

const AWS = require('aws-sdk');
const octokit = require('@octokit/rest')();

const oAuthTokenParameter = process.env.oAuthTokenParameter;
let oAuthToken;

exports.handler = async function(event, context, callback) {
  try {
    // Retrieve the plaintext OAuth token
    if (!oAuthToken) {
      const ssm = new AWS.SSM();
      const params = {
        Name: oAuthTokenParameter,
        WithDecryption: true
      };
      const paramResult = await ssm.getParameter(params).promise();
      oAuthToken = paramResult.Parameter.Value;
    }
    octokit.authenticate({ type: 'oauth', token: oAuthToken });

    // Parse the incoming event
    var sourceUrl = event.detail['additional-information'].source.location;
    console.log(`Source URL: ${sourceUrl}`);
    if (!sourceUrl.startsWith('https://github.com')) {
      console.error(`Not a GitHub repo: ${sourceUrl}`);
      callback(null);
    } else {
      // Parse the GitHub repo URL to get the owner and name
      if (sourceUrl.endsWith('.git')) {
        sourceUrl = sourceUrl.slice(0, -4);
      }

      const urlParts = sourceUrl.split('/');
      const repoOwner = urlParts[urlParts.length-2];
      const repoName = urlParts[urlParts.length-1];
      console.log(`Owner: ${repoOwner}, repo: ${repoName}`);

      var sourceVersion = event.detail['additional-information']['source-version'];
      const buildStatus = event.detail['build-status'];
      console.log(`Source version: ${sourceVersion}`);

      // Resolve source version from CodeBuild event to GitHub commit ID
      // This is not ideal as there is a race condition: if someone pushes a new commit
      // while the previous build is in progress, the wrong commit will get labeled
      // with the status.  But CodeBuild doesn't include a commit ID for pull request build events.
      if (!sourceVersion || sourceVersion == '') {
        sourceVersion = 'HEAD';
      } else if (sourceVersion.startsWith('pr/')) {
        sourceVersion = `refs/pull/${sourceVersion.split('/')[1]}/head`;
      }
      const commitResult = await octokit.repos.getShaOfCommitRef({owner: repoOwner, repo: repoName, ref: sourceVersion});
      const commit = commitResult.data.sha;
      console.log(`Commit: ${commit}`);

      // Create a new status
      var state = 'failure';
      var description = 'DISQUALIFIED!';
      if (buildStatus == 'SUCCEEDED') {
        state = 'pending';
        description = 'SHOW ME WHAT YOU GOT';
      } else if (buildStatus == 'IN_PROGRESS') {
        state = 'pending';
        description = 'I LIKE WHAT YOU GOT';
      }

      await octokit.repos.createStatus({
        owner: repoOwner,
        repo: repoName,
        sha: commit,
        state: state,
        description: description,
        context: 'I\'M CONTINUOUS INTEGRATION RICK!'
      });

      console.log(`Status successfully set! ${state}, ${description}`);
      callback(null);
    }
  } catch (err) {
    // TODO better error handling so that errors (problems with request inputs)
    // are treated as function success, but 500s from GitHub return a function
    // error so that the function is retried.
    console.error(err);
    callback(null, err.message);
  }
};
