import { ModularSimulator } from "./simulators/simulator.js";
import { describe, it, expect } from "vitest";
import * as utils from "./utils/utils";
import { rawTokenType, toHex } from "@midnight-ntwrk/compact-runtime";
import {
  TOKEN_DOMAIN,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  TOKEN_DECIMALS,
} from "../token-metadata.js";

const key1 = 0;

const AMOUNT = 1_000n;

const RECIPIENT = utils.coinKey(utils.randomBytes(32));
const REFUND_TO = utils.coinKey(utils.randomBytes(32));

function createSimulator() {
  return ModularSimulator.deployContract(key1);
}

describe("Shielded token module", () => {
  describe("initialization", () => {
    it("exposes the constructor metadata on the ledger", () => {
      const simulator = createSimulator();
      const ledgerState = simulator.as("p1").getLedger();
      expect(ledgerState.ShieldedToken__name).toEqual(TOKEN_NAME);
      expect(ledgerState.ShieldedToken__symbol).toEqual(TOKEN_SYMBOL);
      expect(ledgerState.ShieldedToken__decimals).toEqual(TOKEN_DECIMALS);
      expect(ledgerState.ShieldedToken__isInitialized).toBe(true);
      expect(ledgerState.ShieldedToken__domain).toEqual(TOKEN_DOMAIN);
    });

    it("computes tokenColor as a stable 32-byte value matching the off-chain derivation", () => {
      const simulator = createSimulator();
      const color = simulator.as("p1").tokenColor();
      expect(color).toBeInstanceOf(Uint8Array);
      expect(color.length).toBe(32);
      // Stable across calls (same domain + same contract address).
      expect(simulator.tokenColor()).toEqual(color);
      // Off-chain derivation used by node and web must agree with the circuit.
      expect(toHex(color)).toEqual(
        rawTokenType(TOKEN_DOMAIN, simulator.contractAddress),
      );
    });
  });

  describe("mint", () => {
    it("returns a coin with color = tokenColor, value = amount, nonce = arg", () => {
      const simulator = createSimulator();
      const nonce = utils.randomBytes(32);
      const { coin } = simulator.as("p1").mint(RECIPIENT, AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toEqual(nonce);
      expect(coin.color).toEqual(simulator.tokenColor());
    });

    it("reverts on a zero recipient key", () => {
      const simulator = createSimulator();
      expect(() =>
        simulator.as("p1").mint(utils.zeroKey(), AMOUNT, utils.randomBytes(32)),
      ).toThrow("NativeShieldedToken: invalid recipient");
    });

    it("reverts on a zero amount", () => {
      const simulator = createSimulator();
      expect(() =>
        simulator.as("p1").mint(RECIPIENT, 0n, utils.randomBytes(32)),
      ).toThrow("modular: zero mint");
    });
  });

  describe("burn (same-tx coin)", () => {
    const coinOf = (value: bigint, color: Uint8Array) => ({
      nonce: utils.randomBytes(32),
      color,
      value,
    });

    it("reverts on a wrong-color coin", () => {
      const simulator = createSimulator();
      expect(() =>
        simulator
          .as("p1")
          .burn(coinOf(AMOUNT, utils.randomBytes(32)), AMOUNT, REFUND_TO),
      ).toThrow("NativeShieldedToken: wrong token");
    });

    it("reverts when amount > coin.value", () => {
      const simulator = createSimulator();
      const color = simulator.as("p1").tokenColor();
      expect(() =>
        simulator.burn(coinOf(AMOUNT, color), AMOUNT + 1n, REFUND_TO),
      ).toThrow("NativeShieldedToken: insufficient coin value");
    });

    it("reverts on a zero refundTo", () => {
      const simulator = createSimulator();
      const color = simulator.as("p1").tokenColor();
      expect(() =>
        simulator.burn(coinOf(AMOUNT, color), 1n, utils.zeroKey()),
      ).toThrow("NativeShieldedToken: invalid refund target");
    });

    it("returns none on a full burn (amount == coin.value)", () => {
      const simulator = createSimulator();
      const color = simulator.as("p1").tokenColor();
      const { change } = simulator.burn(coinOf(AMOUNT, color), AMOUNT, REFUND_TO);
      expect(change.is_some).toBe(false);
    });

    it("returns some(refund) with refund.value == coin.value - amount on a partial burn", () => {
      const simulator = createSimulator();
      const color = simulator.as("p1").tokenColor();
      const { change } = simulator.burn(coinOf(AMOUNT, color), 600n, REFUND_TO);
      expect(change.is_some).toBe(true);
      expect(change.value.value).toBe(AMOUNT - 600n);
    });
  });

  describe("counter coexistence", () => {
    it("increment still works alongside token operations", () => {
      const simulator = createSimulator();
      simulator.as("p1").mint(RECIPIENT, AMOUNT, utils.randomBytes(32));
      const ledgerState = simulator.increment();
      expect(ledgerState.Counter__round).toEqual(1n);
    });
  });
});
