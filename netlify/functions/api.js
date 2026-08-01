// वाक ऋचा — Netlify Function (Blobs backend)
// ──────────────────────────────────────────────────────────────────
//  सभी post/comment/like/pin क्रियाएं यहाँ handle होती हैं।
//  नई पोस्ट बनने पर यह Function स्वचालित रूप से Facebook Page पर
//  भी पोस्ट करता है — FB_PAGE_ID और FB_PAGE_ACCESS_TOKEN env vars
//  की ज़रूरत है (Netlify Dashboard → Site → Environment Variables)।
// ──────────────────────────────────────────────────────────────────

import { getStore } from "@netlify/blobs";

// ── helpers ────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function errorRes(msg, status = 400) {
  return jsonRes({ error: msg }, status);
}

// ── Netlify Blobs store ─────────────────────────────────────────────
function getPostsStore(context) {
  return getStore({ name: "vaakricha-posts", consistency: "strong", ...context });
}

async function loadPosts(store) {
  try {
    const raw = await store.get("posts");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function savePosts(store, posts) {
  await store.set("posts", JSON.stringify(posts));
}

// ── Editor PIN ──────────────────────────────────────────────────────
// संपादक PIN Netlify environment variable EDITOR_PIN से पढ़ा जाता है।
// डिफ़ॉल्ट 1234 — Netlify Dashboard में EDITOR_PIN सेट करें।
function getEditorPin() {
  return process.env.EDITOR_PIN || "2633";
}

function checkPin(pin) {
  return String(pin).trim() === getEditorPin();
}

// ── Facebook auto-post ──────────────────────────────────────────────
//
//  Facebook पर पोस्ट दिखाने के लिए दो env vars चाहिए:
//    FB_PAGE_ID           — आपके Facebook Page का numeric ID
//    FB_PAGE_ACCESS_TOKEN — Page Access Token (long-lived, कभी expire नहीं होता)
//
//  Token कैसे बनाएं — README.md के "Facebook सेटअप" खंड में देखें।
//
async function postToFacebook({ title, content, category, postId, siteUrl, imageBase64 }) {
  const pageId = process.env.FB_PAGE_ID;
  const token  = process.env.FB_PAGE_ACCESS_TOKEN;

  // env vars नहीं मिले → चुपचाप skip (Facebook post fail होने पर साइट की
  // पोस्ट block नहीं होनी चाहिए)
  if (!pageId || !token) {
    console.log("[Facebook] FB_PAGE_ID या FB_PAGE_ACCESS_TOKEN नहीं मिला — skip।");
    return { skipped: true, reason: "env_missing" };
  }

  // पोस्ट का URL (वाक ऋचा साइट पर)
  const postUrl = siteUrl
    ? `${siteUrl.replace(/\/$/, "")}/?post=${encodeURIComponent(postId)}`
    : null;

  // Facebook पर जाने वाला संदेश
  const plain = (content || "").replace(/\s+/g, " ").trim();
  const excerpt = plain.length > 200 ? plain.slice(0, 200) + "…" : plain;

  const categoryLabels = {
    sahitya: "साहित्य", rajniti: "राजनीति", khel: "खेल",
    swasthya: "स्वास्थ्य", saundarya: "सौंदर्य", fashion: "फैशन",
    jeevanshaili: "जीवन शैली", technic: "तकनीक",
    digital: "डिजिटल दुनिया", sthaniya: "स्थानीय मुद्दे",
  };
  const catLabel = categoryLabels[category] || category || "सामान्य";

  const message =
    `📌 ${title}\n\n` +
    `${excerpt}\n\n` +
    `🗂 श्रेणी: ${catLabel}\n` +
    (postUrl ? `\n📖 पूरी रचना पढ़ें: ${postUrl}\n` : "") +
    `\n#वाकऋचा #हिंदीसाहित्य #${catLabel.replace(/\s/g, "")}`;

  // ── Case 1: पोस्ट में छवि है (base64) → पहले FB पर फ़ोटो upload करो ──
  if (imageBase64 && imageBase64.startsWith("data:image/")) {
    try {
      // base64 → binary buffer
      const commaIdx = imageBase64.indexOf(",");
      const base64Data = imageBase64.slice(commaIdx + 1);
      const mimeType = imageBase64.slice(5, imageBase64.indexOf(";"));
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });

      const formData = new FormData();
      formData.append("source", blob, "image.jpg");
      formData.append("message", message);
      formData.append("access_token", token);

      const photoRes = await fetch(
        `https://graph.facebook.com/v19.0/${pageId}/photos`,
        { method: "POST", body: formData }
      );
      const photoJson = await photoRes.json();

      if (!photoRes.ok) {
        console.error("[Facebook] फ़ोटो upload विफल:", photoJson);
        // फ़ोटो fail हुई → बिना फ़ोटो के text/link पोस्ट try करें
      } else {
        console.log("[Facebook] फ़ोटो सहित पोस्ट सफल। ID:", photoJson.id);
        return { success: true, fbPostId: photoJson.id, withPhoto: true };
      }
    } catch (photoErr) {
      console.error("[Facebook] फ़ोटो upload exception:", photoErr);
      // fall-through: बिना फ़ोटो के try करें
    }
  }

  // ── Case 2: link post (छवि नहीं, या छवि upload fail हुई) ──
  const body = {
    message,
    access_token: token,
  };
  if (postUrl) body.link = postUrl;

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/feed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const json = await res.json();

  if (!res.ok) {
    console.error("[Facebook] feed पोस्ट विफल:", json);
    return { success: false, error: json.error };
  }

  console.log("[Facebook] पोस्ट सफल। ID:", json.id);
  return { success: true, fbPostId: json.id };
}

// ── Netlify Identity JWT verify ────────────────────────────────────
async function verifyIdentityToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  // token को GoTrue पर verify करें (Netlify Identity का backend)
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || "";
  try {
    const res = await fetch(`${siteUrl}/.netlify/identity/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json(); // { id, email, user_metadata, ... }
  } catch {
    return null;
  }
}

// ── Main handler ────────────────────────────────────────────────────
export default async function handler(req, context) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
    });
  }

  const store = getPostsStore(context);

  // GET → पूरा feed लौटाएं
  if (req.method === "GET") {
    const posts = await loadPosts(store);
    return jsonRes({ posts });
  }

  if (req.method !== "POST") return errorRes("Method not allowed", 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return errorRes("Invalid JSON");
  }

  const { action } = body;

  // ── createPost ──────────────────────────────────────────────────
  if (action === "createPost") {
    const authHeader = req.headers.get("authorization");
    const user = await verifyIdentityToken(authHeader);
    if (!user) return errorRes("प्रमाणीकरण आवश्यक है — कृपया लॉगिन करें।", 401);

    const { title, category, content, image } = body;
    if (!title || !category || !content)
      return errorRes("शीर्षक, श्रेणी और सामग्री आवश्यक हैं।");

    const posts = await loadPosts(store);
    const post = {
      id: uid(),
      title: title.slice(0, 120),
      category,
      content: content.slice(0, 6000),
      image: image || "",
      name: (user.user_metadata && user.user_metadata.full_name) || user.email.split("@")[0],
      authorEmail: user.email,
      likes: 0,
      comments: [],
      timestamp: new Date().toISOString(),
    };

    posts.unshift(post);
    await savePosts(store, posts);

    // ── Make.com के ज़रिए Facebook पर auto-post ──────────────────
    // Make.com webhook → Facebook Page पर automatically post होगी
    const siteUrl = process.env.URL || process.env.DEPLOY_URL || "";
    postToFacebookViaMake({
      title: post.title,
      content: post.content,
      category: post.category,
      postId: post.id,
      siteUrl,
    }).then((result) => {
      if (result && result.success) {
        console.log(`[Make.com] "${post.title}" → Facebook पर भेजा!`);
      } else {
        console.warn("[Make.com] Facebook पर नहीं भेज सका।");
      }
    }).catch((e) => console.error("[Make.com] Exception:", e));
    // ─────────────────────────────────────────────────────────────

    return jsonRes({ post }, 201);
  }

  // ── verifyPin ────────────────────────────────────────────────────
  if (action === "verifyPin") {
    const { pin } = body;
    return jsonRes({ ok: checkPin(pin) });
  }

  // ── editPost ─────────────────────────────────────────────────────
  if (action === "editPost") {
    const { pin, postId, title, category, content, image } = body;
    if (!checkPin(pin)) return errorRes("गलत पिन।", 403);

    const posts = await loadPosts(store);
    const idx = posts.findIndex((p) => p.id === postId);
    if (idx === -1) return errorRes("पोस्ट नहीं मिली।", 404);

    posts[idx] = {
      ...posts[idx],
      title: (title || posts[idx].title).slice(0, 120),
      category: category || posts[idx].category,
      content: (content || posts[idx].content).slice(0, 6000),
      image: image !== undefined ? image : posts[idx].image,
      editedAt: new Date().toISOString(),
    };
    await savePosts(store, posts);
    return jsonRes({ post: posts[idx] });
  }

  // ── deletePost ───────────────────────────────────────────────────
  if (action === "deletePost") {
    const { pin, postId } = body;
    if (!checkPin(pin)) return errorRes("गलत पिन।", 403);

    const posts = await loadPosts(store);
    const filtered = posts.filter((p) => p.id !== postId);
    await savePosts(store, filtered);
    return jsonRes({ ok: true });
  }

  // ── like ──────────────────────────────────────────────────────────
  if (action === "like") {
    const { postId } = body;
    const posts = await loadPosts(store);
    const p = posts.find((x) => x.id === postId);
    if (!p) return errorRes("पोस्ट नहीं मिली।", 404);
    p.likes = (p.likes || 0) + 1;
    await savePosts(store, posts);
    return jsonRes({ likes: p.likes });
  }

  // ── addComment ───────────────────────────────────────────────────
  if (action === "addComment") {
    const { postId, name, text } = body;
    if (!postId || !name || !text) return errorRes("सभी फ़ील्ड आवश्यक हैं।");

    const posts = await loadPosts(store);
    const p = posts.find((x) => x.id === postId);
    if (!p) return errorRes("पोस्ट नहीं मिली।", 404);

    const comment = {
      id: uid(),
      name: name.slice(0, 60),
      text: text.slice(0, 1000),
      timestamp: new Date().toISOString(),
      replies: [],
    };
    p.comments = p.comments || [];
    p.comments.push(comment);
    await savePosts(store, posts);
    return jsonRes({ comment }, 201);
  }

  // ── deleteComment ────────────────────────────────────────────────
  if (action === "deleteComment") {
    const { pin, postId, commentId } = body;
    if (!checkPin(pin)) return errorRes("गलत पिन।", 403);

    const posts = await loadPosts(store);
    const p = posts.find((x) => x.id === postId);
    if (!p) return errorRes("पोस्ट नहीं मिली।", 404);
    p.comments = (p.comments || []).filter((c) => c.id !== commentId);
    await savePosts(store, posts);
    return jsonRes({ ok: true });
  }

  // ── addReply ─────────────────────────────────────────────────────
  if (action === "addReply") {
    const { postId, commentId, name, text } = body;
    if (!postId || !commentId || !name || !text) return errorRes("सभी फ़ील्ड आवश्यक हैं।");

    const posts = await loadPosts(store);
    const p = posts.find((x) => x.id === postId);
    if (!p) return errorRes("पोस्ट नहीं मिली।", 404);
    const c = (p.comments || []).find((x) => x.id === commentId);
    if (!c) return errorRes("टिप्पणी नहीं मिली।", 404);

    const reply = {
      id: uid(),
      name: name.slice(0, 60),
      text: text.slice(0, 1000),
      timestamp: new Date().toISOString(),
    };
    c.replies = c.replies || [];
    c.replies.push(reply);
    await savePosts(store, posts);
    return jsonRes({ reply }, 201);
  }

  // ── deleteReply ───────────────────────────────────────────────────
  if (action === "deleteReply") {
    const { pin, postId, commentId, replyId } = body;
    if (!checkPin(pin)) return errorRes("गलत पिन।", 403);

    const posts = await loadPosts(store);
    const p = posts.find((x) => x.id === postId);
    if (!p) return errorRes("पोस्ट नहीं मिली।", 404);
    const c = (p.comments || []).find((x) => x.id === commentId);
    if (!c) return errorRes("टिप्पणी नहीं मिली।", 404);
    c.replies = (c.replies || []).filter((r) => r.id !== replyId);
    await savePosts(store, posts);
    return jsonRes({ ok: true });
  }

  return errorRes("Unknown action: " + action);
}

export const config = { path: "/.netlify/functions/api" };
