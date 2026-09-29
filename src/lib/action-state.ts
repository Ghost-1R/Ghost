export type ActionState = {
  error: string | null;
  notice: string | null;
};

export const initialActionState: ActionState = {
  error: null,
  notice: null,
};
