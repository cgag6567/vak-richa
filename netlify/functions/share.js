// वाक ऋचा — हर पोस्ट के लिए Facebook/WhatsApp प्रीव्यू (Open Graph) पेज
//   /share/<postId>            -> पोस्ट के शीर्षक, सार और फ़ोटो वाले OG टैग + इंसानों के लिए /?post=<id> पर रीडायरेक्ट
//   /share-img/<postId>.jpg    -> पोस्ट की फ़ोटो (base64 से असली JPG) ; फ़ोटो न हो तो लोगो

const SITE_NAME = "वाक ऋचा";
const DEFAULT_TITLE = "वाक ऋचा — रचनात्मक अभिव्यक्ति का राष्ट्रीय मंच";
const DEFAULT_DESC = "साहित्य, राजनीति, खेल, स्वास्थ्य, फैशन, तकनीक और स्थानीय मुद्दों पर रचनाएं पढ़ें और प्रकाशित करें।";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function getOrigin(event) {
  const h = event.headers || {};
  const host = h["x-forwarded-host"] || h.host;
  const proto = h["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

async function loadPost(origin, id) {
  const res = await fetch(`${origin}/.netlify/functions/api`, { method: "GET" });
  if (!res.ok) throw new Error("api " + res.status);
  const data = await res.json();
  return (data.posts || []).find((p) => p.id === id) || null;
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const origin = getOrigin(event);

  try {
    /* ---------- फ़ोटो endpoint ---------- */
    if (qs.img) {
      const id = decodeURIComponent(qs.img).replace(/\.(jpe?g|png|webp)$/i, "");
      const post = await loadPost(origin, id);
      const img = post && post.image;

      if (img && /^data:image\/[a-z+.-]+;base64,/i.test(img)) {
        const m = img.match(/^data:(image\/[a-z+.-]+);base64,(.*)$/is);
        return {
          statusCode: 200,
          headers: {
            "Content-Type": m[1],
            "Cache-Control": "public, max-age=86400",
          },
          body: m[2],
          isBase64Encoded: true,
        };
      }
      if (img && /^https?:\/\//i.test(img)) {
        return { statusCode: 302, headers: { Location: img }, body: "" };
      }
      // फ़ोटो नहीं है -> साइट का लोगो
      return { statusCode: 302, headers: { Location: `${origin}/icon-512.png` }, body: "" };
    }

    /* ---------- शेयर पेज ---------- */
    const id = decodeURIComponent(qs.id || "").replace(/\/+$/, "");
    const post = id ? await loadPost(origin, id) : null;

    const shareUrl = `${origin}/share/${encodeURIComponent(id)}`;
    const targetUrl = post ? `${origin}/?post=${encodeURIComponent(id)}` : `${origin}/`;

    const title = post ? `${post.title} — ${SITE_NAME}` : DEFAULT_TITLE;
    let desc = DEFAULT_DESC;
    if (post) {
      const plain = String(post.content || "").replace(/\s+/g, " ").trim();
      desc = plain.length > 200 ? plain.slice(0, 200) + "…" : plain || DEFAULT_DESC;
    }
    const imageUrl = post && post.image
      ? `${origin}/share-img/${encodeURIComponent(id)}.jpg`
      : `${origin}/icon-512.png`;

    const html = `<!DOCTYPE html>
<html lang="hi">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:type" content="article">
<meta property="og:locale" content="hi_IN">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(shareUrl)}">
<meta property="og:image" content="${esc(imageUrl)}">
<meta property="og:image:secure_url" content="${esc(imageUrl)}">
<meta property="og:image:type" content="image/jpeg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(imageUrl)}">
<link rel="canonical" href="${esc(shareUrl)}">
<script>location.replace(${JSON.stringify(targetUrl)});</script>
<noscript><meta http-equiv="refresh" content="0;url=${esc(targetUrl)}"></noscript>
</head>
<body style="font-family:sans-serif;text-align:center;padding:2rem">
<p><a href="${esc(targetUrl)}">रचना पढ़ने के लिए यहाँ क्लिक करें</a></p>
</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
      body: html,
    };
  } catch (err) {
    // कोई भी गड़बड़ी हो तो पाठक को होमपेज पर भेज दें
    return { statusCode: 302, headers: { Location: `${origin}/` }, body: "" };
  }
};
