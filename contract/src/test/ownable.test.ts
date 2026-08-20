import { ModularSimulator } from "./simulators/simulator.js";
import { describe, it, expect } from "vitest";
import * as utils from "./utils/utils";
import { createPrivateState } from "../witnesses.js";
import { computeOwnerCommitment } from "../owner.js";

const AMOUNT = 1_000n;
const RECIPIENT = utils.coinKey(utils.randomBytes(32));
const REFUND_TO = utils.coinKey(utils.randomBytes(32));

const ownerSecret = utils.randomBytes(32);
const strangerSecret = utils.randomBytes(32);

function createSimulator() {
  const simulator = ModularSimulator.deployContract(ownerSecret);
  simulator.createPrivateState("stranger", strangerSecret);
  return simulator;
}

describe("Ownable module", () => {
  describe("initialization", () => {
    it("stores the off-chain computed commitment as the on-chain owner (no hash drift)", () => {
      const simulator = createSimulator();
      const ledgerState = simulator.as("p1").getLedger();
      expect(ledgerState.Ownable__isInitialized).toBe(true);
      expect(ledgerState.Ownable__owner.is_left).toBe(true);
      // The circuit-side persistentHash(wit_OwnableSK()) must equal the
      // TypeScript computeOwnerCommitment — otherwise the passkey deploy
      // handshake breaks silently.
      expect(ledgerState.Ownable__owner.left).toEqual(
        computeOwnerCommitment(ownerSecret)
      );
    });

    it("rejects a zero initial owner commitment", () => {
      expect(
        () =>
          new ModularSimulator(
            createPrivateState(ownerSecret),
            new Uint8Array(32)
          )
      ).toThrow("Ownable: invalid initial owner");
    });
  });

  describe("owner gating", () => {
    it("lets the owner mint", () => {
      const simulator = createSimulator();
      const { coin } = simulator
        .as("p1")
        .mint(RECIPIENT, AMOUNT, utils.randomBytes(32));
      expect(coin.value).toBe(AMOUNT);
    });

    it("rejects mint with a wrong secret", () => {
      const simulator = createSimulator();
      expect(() =>
        simulator.as("stranger").mint(RECIPIENT, AMOUNT, utils.randomBytes(32))
      ).toThrow("Ownable: caller is not the owner");
    });

    it("rejects burn with a wrong secret", () => {
      const simulator = createSimulator();
      const color = simulator.as("p1").tokenColor();
      const coin = { nonce: utils.randomBytes(32), color, value: AMOUNT };
      expect(() =>
        simulator.as("stranger").burn(coin, AMOUNT, REFUND_TO)
      ).toThrow("Ownable: caller is not the owner");
    });
  });

  describe("transferOwnership", () => {
    it("rotates authority to a new commitment", () => {
      const simulator = createSimulator();
      const newCommitment = computeOwnerCommitment(strangerSecret);
      const ledgerState = simulator.as("p1").transferOwnership(newCommitment);
      expect(ledgerState.Ownable__owner.left).toEqual(newCommitment);

      // Old owner is locked out; new owner can mint.
      expect(() =>
        simulator.as("p1").mint(RECIPIENT, AMOUNT, utils.randomBytes(32))
      ).toThrow("Ownable: caller is not the owner");
      const { coin } = simulator
        .as("stranger")
        .mint(RECIPIENT, AMOUNT, utils.randomBytes(32));
      expect(coin.value).toBe(AMOUNT);
    });

    it("rejects transfer from a non-owner", () => {
      const simulator = createSimulator();
      expect(() =>
        simulator
          .as("stranger")
          .transferOwnership(computeOwnerCommitment(strangerSecret))
      ).toThrow("Ownable: caller is not the owner");
    });

    it("rejects a zero new owner commitment", () => {
      const simulator = createSimulator();
      expect(() =>
        simulator.as("p1").transferOwnership(new Uint8Array(32))
      ).toThrow("Ownable: invalid new owner");
    });
  });
});
