/**
 * The demo's GenUI schema — plain data, shared by both sides:
 *
 * - the Worker (`worker/index.ts`) builds the system prompt from it and
 *   validates every streamed message against it (`ingenui/server`);
 * - the client binds the React components to it (`bindGenUi` in
 *   `components.tsx`) and renders.
 *
 * No React, no implementations: importing it on the server pulls in nothing
 * client-side.
 */
import { defineGenUiSchema } from "ingenui/schema";

export const demoSchema = defineGenUiSchema({
  components: {
    Card: { props: {}, description: "A bordered panel grouping related content." },
    CardHeader: { props: {}, description: "The header row of a Card (a Title and Badges)." },
    CardBody: { props: {}, description: "The body of a Card." },
    Title: { props: {}, description: "A heading." },
    Text: { props: {}, description: "A paragraph of text." },
    Badge: {
      props: { tone: "string" },
      description: 'A small status pill. tone: "neutral" | "info" | "success" | "warning".',
    },
    Button: {
      props: { variant: "string", onClick: "function" },
      description: 'A button. variant: "primary" | "ghost". Wire onClick to an action.',
    },
    Avatar: { props: { initials: "string", name: "string" }, description: "A round avatar." },
    Stat: {
      props: { label: "string", value: "node" },
      description: "A big number (value) with a caption (label).",
    },
    Row: { props: {}, description: "Lays its children out horizontally." },
    List: { props: {}, description: "A bulleted list of Items." },
    Item: { props: {}, description: "One List entry." },
    Callout: {
      props: { tone: "string" },
      description: 'A highlighted note. tone: "info" | "warning".',
    },
  },
  actions: {
    addToCart: { description: "Add the product shown in the UI to the user's cart." },
  },
  // Dynamic actions (the default): the model may also invent action names.
});
