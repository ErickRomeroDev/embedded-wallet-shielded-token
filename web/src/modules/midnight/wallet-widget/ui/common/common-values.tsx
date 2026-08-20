import { JSX } from "react";
import IconLace from "./icons/icon-lace";
import Icon1AM from "./icons/icon-1am";
import IconFingerprint from "./icons/icon-fingerprint";

export const walletsListFormat: {
    [key: string]: { key: string; displayName: string; icon: JSX.Element };
  } = {
    lace: { key: "lace", displayName: "LACE", icon: <IconLace /> },
    "1am": { key: "1am", displayName: "1AM", icon: <Icon1AM /> },
    embedded: { key: "embedded", displayName: "PASSKEY", icon: <IconFingerprint /> },
  };

export enum networkID {
  UNDEPLOYED = "undeployed",
  PREVIEW = "preview", 
  PREPROD = "preprod",
  MAINNET = "mainnet"
}