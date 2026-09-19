import type { components } from "./api-schema";

export type Session = components["schemas"]["SessionResponse"];

export type AuthConfig = components["schemas"]["AuthConfig"];

export type Overview = components["schemas"]["Overview"];

export type Problem = {
  title?: string;
  detail?: string;
  status?: number;
};