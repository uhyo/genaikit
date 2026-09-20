/**
 * The set of components the demo allows the streamed JSX to use.
 *
 * In a real app this map doubles as a **security allowlist**: untrusted,
 * AI-generated output can only instantiate components you explicitly list here —
 * anything else degrades to the `<Pending />` frontier instead of rendering.
 */
import type { ComponentType, ReactNode } from "react";

interface WithChildren {
  children?: ReactNode;
}

function Card({ children }: WithChildren) {
  return <div className="ui-card">{children}</div>;
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
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

function Button({ variant = "primary", children }: WithChildren & { variant?: string }) {
  return (
    <button className={`ui-button ui-button--${variant}`} type="button">
      {children}
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

/** Passed to the parser as both the renderer and the allowlist. */
export const demoComponents: Record<string, ComponentType<never>> = {
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
} as Record<string, ComponentType<never>>;

export const componentNames = Object.keys(demoComponents);
