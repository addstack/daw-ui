"use client";

import {
  cloneElement,
  createElement,
  isValidElement,
  useCallback,
  useRef,
  type CSSProperties,
  type ComponentPropsWithRef,
  type JSX,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefCallback,
} from "react";

type AnyProps = Record<string, unknown>;

/**
 * Replaces the element a part renders, as in Base UI: an element to merge the
 * part's props into, or a function that receives them.
 */
export type RenderProp<State> = ReactElement | ((props: Record<string, unknown>, state: State) => ReactElement);

/** Props every part takes, besides the ones of the element it renders. */
export type PartProps<Tag extends keyof JSX.IntrinsicElements, State> = Omit<
  ComponentPropsWithRef<Tag>,
  "className" | "style" | "children"
> & {
  /**
   * Class names. A plain value, never a function of state: the part's state
   * reaches CSS through its `data-*` attributes and CSS variables, which cost
   * no JavaScript when it changes (docs/principles.md, section 7).
   */
  className?: string | undefined;
  /** Merged over the part's own inline style (used for positioning). A plain value, like `className`. */
  style?: CSSProperties | undefined;
  /**
   * Replaces the rendered element: an element to merge the part's props into
   * (`render={<button />}`), or a function `(props, state) => element`.
   */
  render?: RenderProp<State> | undefined;
  children?: ReactNode;
};

/**
 * The style of parts that show text: interface text is not document
 * content, so a drag across controls or a double-click never selects it
 * (docs/principles.md, section 5). A text input being edited stays selectable.
 */
export const unselectable: CSSProperties = { userSelect: "none", WebkitUserSelect: "none" };

const isHandler = (key: string) => /^on[A-Z]/.test(key);

/**
 * Merges the props a part computes with the ones its user passed. The user's
 * event handler runs first; if it calls `event.preventDefault()`, the part's
 * own handler is skipped. Class names join, styles merge. Refs are merged by
 * `useRenderPart`.
 */
export function mergeProps(own: AnyProps, user: AnyProps): AnyProps {
  const merged: AnyProps = { ...own };
  for (const [key, value] of Object.entries(user)) {
    const ownValue = own[key];
    if (value === undefined) continue;
    if (isHandler(key) && typeof value === "function" && typeof ownValue === "function") {
      merged[key] = (event: { defaultPrevented?: boolean }, ...rest: unknown[]) => {
        value(event, ...rest);
        if (!event?.defaultPrevented) ownValue(event, ...rest);
      };
    } else if (key === "className" && typeof ownValue === "string") {
      merged[key] = `${ownValue} ${String(value)}`;
    } else if (key === "style" && ownValue && typeof ownValue === "object") {
      merged[key] = { ...ownValue, ...(value as object) };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void | (() => void) {
  if (typeof ref === "function") return ref(value) ?? undefined;
  if (ref) (ref as { current: T | null }).current = value;
}

export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (value) => {
    const cleanups = refs.map((ref) => assignRef(ref, value));
    return () => {
      refs.forEach((ref, index) => {
        const cleanup = cleanups[index];
        if (cleanup) cleanup();
        else assignRef(ref, null);
      });
    };
  };
}

/** A stable callback ref that forwards to refs which may change between renders. */
export function useMergedRef<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  const latest = useRef(refs);
  latest.current = refs;
  return useCallback((value: T | null) => mergeRefs(...latest.current)(value), []);
}

/** Data attributes from a state object: `{ dragging: true }` becomes `data-dragging=""`. */
export function dataAttributes(state: Record<string, unknown>): AnyProps {
  const attributes: AnyProps = {};
  for (const [key, value] of Object.entries(state)) {
    if (value === true) attributes[`data-${key}`] = "";
    else if (typeof value === "string") attributes[`data-${key}`] = value;
  }
  return attributes;
}

/**
 * Renders a part: its own props, the user's props, and the `render` override.
 * A hook, so that the merged ref stays the same function between renders.
 */
export function useRenderPart<State>(
  tag: keyof JSX.IntrinsicElements,
  state: State,
  userProps: AnyProps & { render?: RenderProp<State> | undefined },
  ownProps: AnyProps,
): ReactElement {
  const { render, ref: userRef, ...rest } = userProps;
  const { ref: ownRef, ...own } = ownProps;
  const renderRef = isValidElement<AnyProps>(render) ? render.props.ref : undefined;
  const ref = useMergedRef(ownRef as Ref<unknown>, userRef as Ref<unknown>, renderRef as Ref<unknown>);

  const props = { ...mergeProps(own, rest), ref };
  if (typeof render === "function") return render(props, state);
  if (isValidElement<AnyProps>(render)) {
    const { ref: _ref, ...renderProps } = render.props;
    return cloneElement(render, { ...mergeProps(props, renderProps), ref });
  }
  return createElement(tag, props);
}
