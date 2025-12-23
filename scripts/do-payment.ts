import { x402Client, wrapAxiosWithPayment, x402HTTPClient } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import axios from "axios";

const signer = privateKeyToAccount(
  process.env.EVM_PRIVATE_KEY as `0x${string}`
);
const client = new x402Client();
registerExactEvmScheme(client, { signer });

const api = wrapAxiosWithPayment(
  axios.create({ baseURL: "http://localhost:4021" }),
  client
);

const response = await api.get("/weather");
console.log("Response:", response.data);

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
