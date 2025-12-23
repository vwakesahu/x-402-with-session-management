import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { paymentMiddleware } from "x402-express";

const app = express();
app.use(express.json());

// Configuration
const PAY_TO = "0x158301463DdC5D55B2384aF6a3994Baa6aDc555D";

let currentRequestIP: string;
let userpath: Map<string, string> = new Map<string, string>();

// Map to track successful payments by IP address
const paidUsers: Map<string, boolean> = new Map<string, boolean>();

// Helper function to get IP from request
function getClientIP(req: Request): string {
  const ipAddress =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.headers["x-real-ip"]?.toString() ||
    (req.connection && req.connection.remoteAddress) ||
    (req.socket && req.socket.remoteAddress) ||
    req.ip ||
    "unknown";

  // Normalize IPv6 localhost
  return ipAddress === "::1" ? "127.0.0.1" : ipAddress;
}

const x402middleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  currentRequestIP = getClientIP(req);
  userpath.set(currentRequestIP, (req.path as string) || "/");

  const hasPaid = paidUsers.get(currentRequestIP) || false;
  if (hasPaid) {
    console.log("payment is done now let then access");
    return next();
  }

  const middleware = paymentMiddleware(
    PAY_TO,
    {
      "/weather": {
        price: "$0.01",
        network: "base-sepolia",
        config: {
          description: "Access to premium content",
          mimeType: "application/json",
          maxTimeoutSeconds: 3600,
        },
      },
    },
    {
      url: "https://facilitator.payai.network",
    }
  );

  // Wrap next to track successful payments
  const wrappedNext = (err?: any) => {
    if (!err) {
      // Payment was successful, mark this IP as paid
      paidUsers.set(currentRequestIP, true);
      console.log(`Payment successful for IP: ${currentRequestIP}`);
      console.log("Current paid users:", Object.fromEntries(paidUsers));
      return next();
    }
    return next(err);
  };

  await middleware(req, res, wrappedNext);
};

app.use(x402middleware);

app.get("/weather", async (req, res) => {
  return res.status(200).json({
    weather: "is sunny",
    route: "permium",
  });
});

// Endpoint to check payment status for current IP
app.get("/payment-status", async (req: Request, res: Response) => {
  const ip = getClientIP(req);
  const hasPaid = paidUsers.get(ip) || false;
  return res.status(200).json({
    ip,
    hasPaid,
  });
});

// Helper function to check if an IP has paid
function hasUserPaid(ip: string): boolean {
  return paidUsers.get(ip) || false;
}

// Export the paidUsers map for external access

app.listen(8000, () => {
  console.log("server is listening on port 9000");
});
