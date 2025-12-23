import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { writeFileSync, readFileSync, existsSync } from "fs";

const app = express();

// Configuration
const PAY_TO = "0x376b7271dD22D14D82Ef594324ea14e7670ed5b2";
const PAYMENTS_FILE = "payments.json";

// Payment data structure
interface PaymentRecord {
  payer: string;
  transaction: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  ipAddress: string;
  timestamp: string;
}

// Load existing payments
let payments: PaymentRecord[] = loadPaymentsFromFile();

// Free access tracking (IP -> expiry timestamp)
const freeAccessMap = new Map<string, number>();

// Active payment tracking (IP -> start timestamp)
const activePayments = new Map<string, number>();

// Global IP tracking for current request
let currentRequestIP = "unknown";

// Initialize x402 server
const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});

const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);

// Payment settlement handler
server.onAfterSettle(async (context) => {
  const { result, requirements } = context;

  if (result.success) {
    // Remove from active payments
    activePayments.delete(currentRequestIP);

    // Grant 10 seconds of free access
    const freeAccessExpiry = Date.now() + 10000;
    freeAccessMap.set(currentRequestIP, freeAccessExpiry);

    // Record payment
    const paymentRecord: PaymentRecord = {
      payer: result.payer || "unknown",
      transaction: result.transaction,
      network: result.network,
      amount: requirements.amount,
      asset: requirements.asset,
      payTo: requirements.payTo,
      ipAddress: currentRequestIP,
      timestamp: new Date().toISOString(),
    };

    payments.push(paymentRecord);
    savePaymentsToFile();

    console.log(`💰 Payment recorded: ${result.transaction.slice(0, 10)}...`);
  } else {
    // Payment failed, remove from active payments
    activePayments.delete(currentRequestIP);
  }
});

function loadPaymentsFromFile(): PaymentRecord[] {
  if (!existsSync(PAYMENTS_FILE)) return [];

  try {
    const fileContent = readFileSync(PAYMENTS_FILE, "utf-8").trim();
    return fileContent ? JSON.parse(fileContent) : [];
  } catch (error) {
    console.error("Error loading payments file:", error);
    return [];
  }
}

function savePaymentsToFile() {
  try {
    writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2));
  } catch (error) {
    console.error("Error saving payments file:", error);
  }
}

// IP extraction middleware
app.use((req, res, next) => {
  const ipAddress =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.headers["x-real-ip"]?.toString() ||
    (req.connection && req.connection.remoteAddress) ||
    (req.socket && req.socket.remoteAddress) ||
    req.ip ||
    "unknown";

  // Normalize IPv6 localhost
  currentRequestIP = ipAddress === "::1" ? "127.0.0.1" : ipAddress;
  next();
});

// Free access and payment middleware (only for /weather route)
app.use((req, res, next) => {
  if (req.path !== "/weather" || req.method !== "GET") {
    return next();
  }

  const now = Date.now();
  const freeAccessExpiry = freeAccessMap.get(currentRequestIP);
  const activePaymentStart = activePayments.get(currentRequestIP);

  // Check for free access
  if (freeAccessExpiry && now < freeAccessExpiry) {
    const remainingTime = Math.ceil((freeAccessExpiry - now) / 1000);
    return res.json({
      report: { weather: "sunny", temperature: 70 },
      freeAccess: true,
      remainingSeconds: remainingTime,
    });
  }

  // Check for concurrent payment requests
  if (activePaymentStart) {
    const timeSinceStart = now - activePaymentStart;
    if (timeSinceStart < 5000) {
      return next(); // Allow concurrent requests within 5 seconds
    } else {
      return res.status(409).json({
        error: "Payment in progress",
        message:
          "A payment is already being processed for this IP address. Please wait.",
      });
    }
  }

  // Mark payment as active and proceed
  activePayments.set(currentRequestIP, now);
  next();
});

// x402 Payment middleware
app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.001",
            network: "eip155:84532",
            payTo: PAY_TO,
          },
        ],
        description: "Get current weather data for any location",
        mimeType: "application/json",
      },
    },
    server
  )
);

// Fallback weather route (only reached if free access middleware didn't handle it)
app.get("/weather", (req, res) => {
  res.json({
    report: {
      weather: "sunny",
      temperature: 70,
    },
  });
});

// Payments endpoint
app.get("/payments", (req, res) => {
  res.json({
    totalPayments: payments.length,
    payments,
  });
});

// Start server
const PORT = 4021;
app.listen(PORT, () => {
  console.log(`🚀 x402 Server running on http://localhost:${PORT}`);
  console.log(`📊 Loaded ${payments.length} payments from ${PAYMENTS_FILE}`);
});
