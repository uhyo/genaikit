/**
 * Sample JSX strings to stream. Each stays within the parser's supported subset:
 * elements, string/boolean/expression attributes, text, nested elements, and
 * `{ }` expressions limited to literals or a nested JSX element.
 */
export interface Sample {
  id: string;
  label: string;
  jsx: string;
}

export const samples: Sample[] = [
  {
    id: "product",
    label: "Product card",
    jsx: `<Card>
  <CardHeader>
    <Title>Aurora Headphones</Title>
    <Badge tone="success">In stock</Badge>
  </CardHeader>
  <CardBody>
    <Text>
      Wireless over-ear headphones with adaptive noise cancellation and a
      30-hour battery.
    </Text>
    <Row>
      <Stat label="Price" value={"$249"} />
      <Stat label="Rating" value={4.8} />
      <Stat label="Reviews" value={1284} />
    </Row>
    <Button variant="primary">Add to cart</Button>
  </CardBody>
</Card>`,
  },
  {
    id: "profile",
    label: "Profile + fragment",
    jsx: `<Card>
  <Row>
    <Avatar initials="UH" name="uhyo" />
    <CardBody>
      <Title>uhyo</Title>
      <Text>Maintainer of jsx-incremental-parser.</Text>
      <>
        <Badge tone="info">TypeScript</Badge>
        <Badge tone="neutral">React</Badge>
        <Badge tone="success">OSS</Badge>
      </>
    </CardBody>
  </Row>
  <Button variant="ghost">Follow</Button>
</Card>`,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    jsx: `<Card>
  <Title>This week</Title>
  <Row>
    <Stat label="Visitors" value={9320} />
    <Stat label="Signups" value={418} />
    <Stat label="Churn" value={"1.2%"} />
  </Row>
  <Callout tone="info">
    Traffic is up <Badge tone="success">+12%</Badge> versus last week.
  </Callout>
  <List>
    <Item>Shipped streaming parser</Item>
    <Item>Added the live demo</Item>
    <Item>Wrote the docs</Item>
  </List>
</Card>`,
  },
  {
    id: "malformed",
    label: "Malformed (lenient)",
    jsx: `<Card>
  <Title>Resilient by design</Title>
  <Text>
    This snippet is missing close tags and uses an unsupported expression
    {someVariable + 1} — the parser recovers instead of throwing.
  <Badge tone="warning">auto-closed`,
  },
];
