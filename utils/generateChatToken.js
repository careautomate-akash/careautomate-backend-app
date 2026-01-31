import twilio from 'twilio'; // full import

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function generateChatToken(identity) {
  try {
    const serviceSid = process.env.TWILIO_CONVERSATIONS_SERVICE_SID;
    const syncServiceSid = process.env.TWILIO_SYNC_SERVICE_SID;
    const apiKey = process.env.TWILIO_API_KEY;
    const apiSecret = process.env.TWILIO_API_SECRET;

    // Enable reachability if not already enabled
    try {
      const config = await client.conversations.v1
        .services(serviceSid)
        .configuration()
        .fetch();
      if (!config.reachabilityEnabled) {
        await client.conversations.v1
          .services(serviceSid)
          .configuration()
          .update({ reachabilityEnabled: true });
      }
    } catch (err) {
      console.warn('⚠️ Failed to check/enable reachability:', err.message);
    }

    // Ensure user exists in the Conversations service
    try {
      await client.conversations.v1
        .services(serviceSid)
        .users(identity)
        .fetch();
    } catch (error) {
      if (error.status === 404) {
        await client.conversations.v1
          .services(serviceSid)
          .users.create({ identity });
      } else {
        throw error;
      }
    }

    // Generate token with Chat and Sync grants
    const {
      jwt: { AccessToken },
    } = twilio;
    const { ChatGrant, SyncGrant } = AccessToken;

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      apiKey,
      apiSecret,
      { identity }
    );

    token.addGrant(new ChatGrant({ serviceSid }));
    token.addGrant(new SyncGrant({ serviceSid: syncServiceSid }));
    return token.toJwt();
  } catch (error) {
    console.error('❌ Error generating chat token:', error);
    throw new Error(`Failed to generate chat token: ${error.message}`);
  }
}
