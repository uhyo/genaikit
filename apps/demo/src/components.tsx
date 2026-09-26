/**
 * The set of components the demo allows the streamed JSX to use.
 *
 * In a real app this map doubles as a **security allowlist**: untrusted,
 * AI-generated output can only instantiate components you explicitly list here —
 * anything else degrades to the `<Pending />` frontier instead of rendering.
 */
import { createContext, useContext } from "react";
import type { ComponentType, ReactNode } from "react";
import { useIsElementComplete } from "@ingenui/incremental-jsx-parser/react";
import { bindGenUi } from "ingenui";

import { demoSchema } from "./genui-schema";

interface WithChildren {
  children?: ReactNode;
}

/**
 * Set by compact inline components (Badge, Button) so the frontier inside
 * them renders nothing: a full-width shimmer would make them longer than
 * they will finally be.
 */
const HidePendingContext = createContext(false);

/** Frontier placeholder: a shimmering block shown wherever content is pending. */
export function Shimmer() {
  if (useContext(HidePendingContext)) return null;
  return <span className="shimmer" aria-label="loading" />;
}

function Card({ children }: WithChildren) {
  // Rainbow border while the card's children are still streaming in.
  const complete = useIsElementComplete();
  return (
    <div className={`ui-card ${complete ? "" : "ui-card--pending"}`} aria-busy={!complete}>
      {children}
    </div>
  );
}

function CardHeader({ children }: WithChildren) {
  return <div className="ui-card__header">{children}</div>;
}

function CardBody({ children }: WithChildren) {
  return <div className="ui-card__body">{children}</div>;
}

function Title({ children }: WithChildren) {
  return <h3 className="ui-title">{children}</h3>;
}

function Text({ children }: WithChildren) {
  return <p className="ui-text">{children}</p>;
}

function Badge({ tone = "neutral", children }: WithChildren & { tone?: string }) {
  const complete = useIsElementComplete();
  return (
    <span className={`ui-badge ui-badge--${tone} ${complete ? "" : "ui-badge--pending"}`}>
      <HidePendingContext value={!complete}>{children}</HidePendingContext>
    </span>
  );
}

function Button({
  variant = "primary",
  onClick,
  children,
}: WithChildren & { variant?: string; onClick?: () => void }) {
  // `onClick` is forwarded so streamed UI can wire `actions.*` references
  // (the parser only ever passes functions resolved from predefined
  // variables here — string handlers are rejected by the schema).
  // Disabled until its label has fully arrived, so a half-streamed button
  // can't be clicked.
  const complete = useIsElementComplete();
  return (
    <button
      className={`ui-button ui-button--${variant}`}
      type="button"
      onClick={onClick}
      disabled={!complete}
      aria-busy={!complete}
    >
      <HidePendingContext value={!complete}>{children}</HidePendingContext>
    </button>
  );
}

function Avatar({ initials, name }: { initials?: string; name?: string }) {
  return (
    <span className="ui-avatar" title={name}>
      {initials ?? name?.slice(0, 2) ?? "?"}
    </span>
  );
}

function Stat({ label, value }: { label?: string; value?: ReactNode }) {
  return (
    <div className="ui-stat">
      <span className="ui-stat__value">{value}</span>
      <span className="ui-stat__label">{label}</span>
    </div>
  );
}

function Row({ children }: WithChildren) {
  return <div className="ui-row">{children}</div>;
}

function List({ children }: WithChildren) {
  return <ul className="ui-list">{children}</ul>;
}

function Item({ children }: WithChildren) {
  return <li className="ui-item">{children}</li>;
}

function Callout({ tone = "info", children }: WithChildren & { tone?: string }) {
  return <div className={`ui-callout ui-callout--${tone}`}>{children}</div>;
}

const implementations = {
  Card,
  CardHeader,
  CardBody,
  Title,
  Text,
  Badge,
  Button,
  Avatar,
  Stat,
  Row,
  List,
  Item,
  Callout,
};

/**
 * ingenui mode: the implementations bound to the shared schema. `bindGenUi`
 * type-checks each component's props against what the schema lets the model
 * pass (and throws if the catalog and the schema disagree).
 */
export const genUi = bindGenUi(demoSchema, { components: implementations });

/** Parser mode: passed to the parser as both the renderer and the allowlist. */
export const demoComponents = implementations as Record<string, ComponentType<never>>;

export const componentNames = Object.keys(demoComponents);
