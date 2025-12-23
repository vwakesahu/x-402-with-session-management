import { x402Client, wrapAxiosWithPayment, x402HTTPClient } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import axios from "axios";
import type { AxiosResponse } from "axios";

const signer = privateKeyToAccount(
  process.env.EVM_PRIVATE_KEY as `0x${string}`
);
const client = new x402Client();
registerExactEvmScheme(client, { signer });

const api = wrapAxiosWithPayment(
  axios.create({ baseURL: "http://localhost:8000" }),
  client
);

let response: AxiosResponse;
try {
  response = await api.get("/");
  console.log("Response status:", response.status);
  console.log("Response data:", response.data);
} catch (error: any) {
  if (error.response?.status === 402) {
    console.log("❌ Payment required - user has NOT paid");
    console.log("Payment details:", error.response.data);
  } else {
    console.log("Error in fetching:", error.message);
  }
  process.exit(1);
}
// const response = await axios.get("http://localhost:4021/weather");

// console.log(response);
// console.log("Response:", response.data);

// Check if this was a paid request or free access
const paymentResponseHeader =
  response.headers["x-payment-response"] ||
  response.headers["X-PAYMENT-RESPONSE"];
const isFreeAccess = response.data.freeAccess === true;

if (paymentResponseHeader && !isFreeAccess) {
  // This was a paid request - get settlement info
  const httpClient = new x402HTTPClient(client);
  const paymentResponse = httpClient.getPaymentSettleResponse(
    (name) => response.headers[name.toLowerCase()]
  );
  console.log("Payment settled:", paymentResponse);
} else if (isFreeAccess) {
  // This was free access - no payment processing needed
  console.log(`✅ Free access - ${response.data.remainingSeconds}s remaining`);
} else {
  // This was free access (fallback detection)
  console.log("✅ Free access - no payment required");
}
