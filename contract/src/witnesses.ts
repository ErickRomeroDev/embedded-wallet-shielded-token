// This is how we type an empty object.
export type ModularPrivateState = {
  privateCounter: number;
};

export const createPrivateState = (value: number): ModularPrivateState => {
  return {
    privateCounter: value,
  };
};

export const witnesses = {};
