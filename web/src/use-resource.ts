import { startTransition, useEffect, useState } from "react";

export type ResourceState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export function useResource<T>(
  load: () => Promise<T>,
  dependencies: unknown[] = [],
): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void load()
      .then((data) => {
        if (active) startTransition(() => setState({ status: "ready", data }));
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Data is temporarily unavailable.",
          });
      });
    return () => {
      active = false;
    };
    // The caller controls reload identity through the explicit dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return state;
}
