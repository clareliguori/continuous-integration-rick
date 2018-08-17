'use strict';

const AWS = require('aws-sdk');
const url = require('url');
const https = require('https');

const oAuthTokenParameter = process.env.oAuthTokenParameter;
let oAuthToken;

function postMessage(statusUrl, statusData, callback) {
  const body = JSON.stringify(statusData);
  const options = url.parse(statusUrl);
  options.method = 'POST';
  options.headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Authorization': `token ${oAuthToken}`
  };

  const postReq = https.request(options, (res) => {
    const chunks = [];
    res.setEncoding('utf8');
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      if (callback) {
        callback({
          body: chunks.join(''),
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
        });
      }
    });
    return res;
  });

  postReq.write(body);
  postReq.end();
}

function processEvent(event, callback) {
  const buildStatus = event.detail['build-status'];
  const sourceUrl = event.detail['additional-information'].source.location;
  // TODO assumes https://github.com/owner/repo
  // Need to handle things like non-GitHub repos, .git on the end of the URL, or extra path stuff at the front
  const repo = url.parse(sourceUrl).pathname;
  // TODO need validation on the commit ID or PR ref
  const sourceVersion = event.detail['additional-information']['source-version'];

  var statusUrl = `https://api.github.com/repos/${repo}/statuses/${sourceVersion}`;

  var state = 'failure';
  var description = 'DISQUALIFIED!';

  if (buildStatus == 'SUCCEEDED') {
    state = 'pending';
    description = 'SHOW ME WHAT YOU GOT';
  } else if (buildStatus == 'IN_PROGRESS') {
    state = 'pending';
    description = 'I LIKE WHAT YOU GOT';
  }

  const statusData = {
    'context': 'I\'M CONTINUOUS INTEGRATION RICK!',
    'state': state,
    'description': description
  };

  postMessage(statusUrl, statusData, (response) => {
    if (response.statusCode < 400) {
      console.info('Message posted successfully');
      callback(null);
    } else if (response.statusCode < 500) {
      console.error(`Error posting message to GitHub API: ${response.statusCode} - ${response.statusMessage}`);
      callback(null);  // Don't retry because the error is due to a problem with the request
    } else {
      // Let Lambda retry
      callback(`Server error when processing message: ${response.statusCode} - ${response.statusMessage}`);
    }
  });
}

exports.handler = (event, context, callback) => {
  if (oAuthToken) {
    processEvent(event, callback);
  } else if (oAuthTokenParameter) {
    const ssm = new AWS.SSM();
    const params = {
      Name: oAuthTokenParameter,
      WithDecryption: true
    };
    ssm.getParameter(params, (err, data) => {
      if (err) {
        console.log('OAuth token parameter error:', err);
        return callback(err);
      }
      oAuthToken = data.Parameter.Value;
      processEvent(event, callback);
    });
  } else {
    callback('OAuth token parameter has not been set.');
  }
};
