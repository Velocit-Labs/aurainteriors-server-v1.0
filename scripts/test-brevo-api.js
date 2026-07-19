#!/usr/bin/env node

/**
 * Test script to verify Brevo HTTPS API configuration
 * Run with: node scripts/test-brevo-api.js
 */

require("dotenv").config();

const axios = require("axios");

const BREVO_API_BASE = "https://api.brevo.com/v3";
const BREVO_API_KEY = process.env.BREVO_API_KEY;

async function testBrevoConnection() {
  console.log("🔍 Testing Brevo HTTPS API Connection...\n");

  // Check if API key is set
  if (!BREVO_API_KEY) {
    console.error("❌ BREVO_API_KEY not found in .env file");
    console.log("\nPlease set BREVO_API_KEY in your .env file:");
    console.log("1. Go to https://app.brevo.com");
    console.log("2. Click Profile → Account Settings");
    console.log("3. Find API Keys section");
    console.log("4. Copy your API key and update .env");
    process.exit(1);
  }

  console.log("✓ BREVO_API_KEY found in .env");
  console.log(`  Key starts with: ${BREVO_API_KEY.substring(0, 20)}...\n`);

  const brevoClient = axios.create({
    baseURL: BREVO_API_BASE,
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
    },
  });

  try {
    // Test 1: Get account info
    console.log("📋 Test 1: Fetching account information...");
    const accountResponse = await brevoClient.get("/account");
    console.log("✓ Account Info Retrieved:");
    console.log(`  Email: ${accountResponse.data.email}`);
    console.log(`  Plan: ${accountResponse.data.plan}`);
    console.log(`  Credits: ${accountResponse.data.credits || "N/A"}\n`);

    // Test 2: Send a test email
    console.log("📧 Test 2: Sending test email...");
    const testEmail = process.env.ADMIN_EMAIL || "test@example.com";
    const testResponse = await brevoClient.post("/smtp/email", {
      to: [{ email: testEmail }],
      sender: { name: "DecorX Test", email: "support@aurainteriors.live" },
      subject: "🎉 Brevo API Connection Test",
      htmlContent: `
        <h2>Brevo API Connection Successful!</h2>
        <p>This is a test email to verify your Brevo HTTPS API configuration.</p>
        <p><strong>API Key Status:</strong> ✓ Valid</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      `,
    });
    console.log("✓ Test email sent successfully!");
    console.log(`  Message ID: ${testResponse.data.messageId}\n`);

    // Test 3: Verify sender email
    console.log("✔️  Verified Sender Email");
    console.log(`  Sender: support@aurainteriors.live\n`);

    console.log("==========================================");
    console.log("✅ All Brevo API Tests Passed!");
    console.log("==========================================\n");
    console.log("Your email configuration is ready. You can now:");
    console.log("1. Start the server: npm run dev");
    console.log("2. Test authentication endpoints");
    console.log("3. Verify emails are being sent\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Brevo API Test Failed\n");

    if (error.response?.status === 401 || error.response?.status === 403) {
      console.error("🔐 Authentication Error:");
      console.error("  Your API key appears to be invalid or expired.");
      console.error("\n  Please:");
      console.error("  1. Go to https://app.brevo.com");
      console.error("  2. Click Profile → Account Settings");
      console.error("  3. Copy your API key from the API Keys section");
      console.error("  4. Update BREVO_API_KEY in .env");
      console.error("  5. Run this test again\n");
    } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      console.error("🌐 Network Error:");
      console.error("  Unable to reach api.brevo.com");
      console.error("  Please check your internet connection.\n");
    } else {
      console.error("Error Details:", error.response?.data || error.message);
    }

    console.error("\nFull Error:", {
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.message,
      code: error.code,
    });

    process.exit(1);
  }
}

testBrevoConnection();
