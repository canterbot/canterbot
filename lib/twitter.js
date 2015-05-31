var Twitter = require('twitter');
 
var client = new Twitter({
  consumer_key: 'ReKoB2keFqcT6Dg0rXIGGlIIK',
  consumer_secret: 'hiKpuqfp4m0558JOsNnz7UJItD0aUiAcZdwFN678U3bWSm5lEM',
  access_token_key: '3231113641-N8KzabBkthi3zctCHSfyXKCUfPwM2ZX3wGp9v90',
  access_token_secret: 'DyuaOQcfuvK9qeGc0PmYuioVF18TTMHUsvMA4ANhITWWQ'
});

var params = {screen_name: 'canterbot'};

module.exports = {

	// Post the provided tweet to Twitter feed
	postTweet: function(tweet){
		client.post('statuses/update', {status: tweet},  function(error, tweetBody, response){
		  if(error) throw error;
		  console.log("Tweeted: " + tweet);
		});
	}
	
};
