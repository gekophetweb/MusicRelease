import { Body, Column, Container, Head, Heading, Hr, Html, Img, Link, Preview, Row, Section, Text } from "react-email";
import type { ReleaseView } from "@/releases/queries";

const C = { paper: "#f6f5f8", ink: "#241631", muted: "#6b5e78", plum: "#4a2160", marigold: "#f2b134", line: "#e3dde9" };
const font = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function ReleaseRow({ r }: { r: ReleaseView }) {
  return (
    <Row style={{ marginBottom: 16 }}>
      <Column style={{ width: 88, verticalAlign: "top" }}>
        {r.coverUrl ? (
          <Img src={r.coverUrl} width="76" height="76" alt="" style={{ borderRadius: 2, display: "block" }} />
        ) : (
          <div style={{ width: 76, height: 76, background: C.line, borderRadius: 2 }} />
        )}
      </Column>
      <Column style={{ verticalAlign: "top" }}>
        <Text style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.ink }}>{r.title}</Text>
        <Text style={{ margin: "2px 0 0", fontSize: 14, color: C.muted }}>{r.artists.join(", ")}</Text>
        <Text style={{ margin: "2px 0 6px", fontSize: 12, color: C.muted }}>{r.dateLabel}</Text>
        <Link href={r.url} style={{ fontSize: 14, color: C.plum, fontWeight: 600 }}>
          Listen on {r.provider === "tidal" ? "TIDAL" : "Spotify"}
        </Link>
      </Column>
    </Row>
  );
}

function Group({ title, items }: { title: string; items: ReleaseView[] }) {
  if (items.length === 0) return null;
  return (
    <Section style={{ marginTop: 24 }}>
      <Heading as="h2" style={{ fontSize: 20, color: C.ink, margin: "0 0 14px" }}>
        {title}
      </Heading>
      {items.map((r) => (
        <ReleaseRow key={r.id} r={r} />
      ))}
    </Section>
  );
}

export function WeeklyDigestEmail(props: {
  siteName: string;
  siteUrl: string;
  rangeLabel: string;
  albums: ReleaseView[];
  singles: ReleaseView[];
  unsubscribeUrl: string;
}) {
  const total = props.albums.length + props.singles.length;
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${total} new release${total === 1 ? "" : "s"} from artists you follow`}</Preview>
      <Body style={{ background: C.paper, fontFamily: font, margin: 0, padding: "24px 0" }}>
        <Container style={{ maxWidth: 560, background: "#ffffff", padding: "28px 28px 20px", borderRadius: 6 }}>
          <Text style={{ margin: 0, fontSize: 13, color: C.muted }}>{props.siteName}</Text>
          <Heading as="h1" style={{ fontSize: 26, color: C.ink, margin: "6px 0 4px" }}>
            New this week
          </Heading>
          <Text style={{ margin: 0, fontSize: 14, color: C.muted }}>
            {props.rangeLabel}: {total} release{total === 1 ? "" : "s"} from artists you follow.
          </Text>
          <Group title="Albums" items={props.albums} />
          <Group title="Singles & EPs" items={props.singles} />
          <Hr style={{ borderColor: C.line, margin: "24px 0 12px" }} />
          <Text style={{ fontSize: 12, color: C.muted, margin: 0 }}>
            <Link href={`${props.siteUrl}/releases`} style={{ color: C.plum }}>
              See all releases
            </Link>{" "}
            or{" "}
            <Link href={props.unsubscribeUrl} style={{ color: C.muted }}>
              stop these emails
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
