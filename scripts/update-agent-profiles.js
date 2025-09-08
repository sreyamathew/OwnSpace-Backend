const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function updateAgentProfiles() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ownspace', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB');

    // Find all agents
    const agents = await User.find({ userType: 'agent' });
    console.log(`Found ${agents.length} agents to update`);

    // Update each agent to have the new fields
    for (const agent of agents) {
      // Only update if the fields don't exist
      if (agent.agentProfile.tempPassword === undefined) {
        agent.agentProfile.tempPassword = false;
      }
      if (agent.agentProfile.passwordChanged === undefined) {
        agent.agentProfile.passwordChanged = false;
      }
      
      await agent.save();
      console.log(`Updated agent: ${agent.name} (${agent.email})`);
    }

    console.log('All agents updated successfully!');
  } catch (error) {
    console.error('Error updating agents:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the migration
updateAgentProfiles();
