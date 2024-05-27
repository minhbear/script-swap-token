import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  TransactionConfirmationStrategy,
  VersionedTransaction,
} from "@solana/web3.js";
import fetch from "cross-fetch";
import { Wallet } from "@project-serum/anchor";
import bs58 from "bs58";

import * as dotenv from "dotenv";
import {
  getSignature,
  isNotNil,
  transactionSenderAndConfirmationWaiter,
} from "./util";
dotenv.config();

const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
const wallet = new Wallet(
  Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY as string))
);

const SOL_ADDRESS = "So11111111111111111111111111111111111111112";
const SOL_AMOUNT = 0.1 * LAMPORTS_PER_SOL;
const USDC_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

interface IQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  platformFee: number | null;
  priceImpactPct: string;
  routePlan: any;
  contextSlot: number;
  timeTaken: number;
}

interface ISwapTransaction {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

const buildAPIGetQuoteSwapToken = (params: {
  inputMint: string;
  outputMint: string;
  swapAmount: number;
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
  platformFeeBps?: number;
  asLegacyTransaction?: boolean;
  excludeDexes?: [];
  maxAccounts?: number;
  onlyDirectRoutes?: boolean;
}): string => {
  const {
    inputMint,
    outputMint,
    swapAmount,
    slippageBps,
    maxAccounts,
    asLegacyTransaction,
    excludeDexes,
    platformFeeBps,
    swapMode,
    onlyDirectRoutes,
  } = params;

  let api =
    `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${swapAmount}`;

  if (isNotNil(slippageBps)) {
    api += `&slippageBps=${slippageBps}`;
  }

  if (isNotNil(swapMode)) {
    api += `&swapMode=${swapMode}`;
  }

  if (isNotNil(platformFeeBps)) {
    api += `&platformFeeBps=${platformFeeBps}`;
  }

  if (isNotNil(onlyDirectRoutes)) {
    api += `&onlyDirectRoutes=${onlyDirectRoutes}`;
  }

  if (isNotNil(maxAccounts)) {
    api += `&maxAccounts=${maxAccounts}`;
  }

  if (isNotNil(asLegacyTransaction)) {
    api += `&asLegacyTransaction=${asLegacyTransaction}`;
  }

  if (isNotNil(excludeDexes)) {
    api += `&excludeDexes=${excludeDexes}`;
  }

  return api;
};

const getSwapTransaction = async (
  quoteResponse: IQuoteResponse,
  userPublicKey: string
): Promise<ISwapTransaction> => {
  const swapTransactionObj: ISwapTransaction = await (
    await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // quoteResponse from /quote api
        quoteResponse,
        // user public key to be used for the swap
        userPublicKey,
        // auto wrap and unwrap SOL. default is true
        wrapAndUnwrapSol: true,
        // feeAccount is optional. Use if you want to charge a fee.  feeBps must have been passed in /quote API.
        // feeAccount: "fee_account_public_key"
      }),
    })
  ).json();

  return swapTransactionObj;
};

const swapToken = async () => {
  try {
    // Swapping SOL to USDC with input 0.1 SOL and 0.5% slippage
    const quoteResponse: IQuoteResponse = await (
      await fetch(
        buildAPIGetQuoteSwapToken({
          inputMint: SOL_ADDRESS,
          outputMint: USDC_ADDRESS,
          swapAmount: SOL_AMOUNT,
          slippageBps: 50,
        })
      )
    ).json();
    const swapTransactionObj = await getSwapTransaction(
      quoteResponse,
      wallet.publicKey.toString()
    );
    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(
      swapTransactionObj.swapTransaction,
      "base64"
    );
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    console.log("🚀 ~ swapToken ~ transaction:", transaction);

    // sign the transaction
    transaction.sign([wallet.payer]);
    const signature = getSignature(transaction);

    // simulate transaction
    const { value: simulatedTransactionResponse } =
      await connection.simulateTransaction(transaction, {
        replaceRecentBlockhash: true,
        commitment: "processed",
      });
    const { err, logs } = simulatedTransactionResponse;

    if (err) {
      // Simulation error, we can check the logs for more details
      // If you are getting an invalid account error, make sure that you have the input mint account to actually swap from.
      console.error("Simulation Error:");
      console.error({ err, logs });
      return;
    }

    const serializedTransaction = Buffer.from(transaction.serialize());
    const blockhash = transaction.message.recentBlockhash;

    const transactionResponse = await transactionSenderAndConfirmationWaiter({
      connection,
      serializedTransaction,
      blockhashWithExpiryBlockHeight: {
        blockhash,
        lastValidBlockHeight: swapTransactionObj.lastValidBlockHeight,
      },
    });

    // If we are not getting a response back, the transaction has not confirmed.
    if (!transactionResponse) {
      console.error("Transaction not confirmed");
      return;
    }

    if (transactionResponse.meta?.err) {
      console.error(transactionResponse.meta?.err);
    }

    console.log(`https://solscan.io/tx/${signature}`);
  } catch (error) {
    console.log("Error: ", error);
  }
};

swapToken();
