import { getStore } from "@netlify/blobs";

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

function getEditorPin() {
  return process.env.EDITOR_PIN || "1234";
}

function checkPin(pin) {
  return String(pin).trim() === getEditorPin();
}

async function postToFacebookViaMake({ title, content, category, postId, siteUrl }) {
  const MAKE_URL = "https://hook.eu1.make.com/uqudmyx4l4eqlplxghv3fdo6g6sl9tdj";

  const postUrl = siteUrl
    ? `${siteUrl.replace(/\/$/, "")}/?post=${encodeURIComponent(postId)}`
    : "";

  const plain = (content || "").replace(/\s+/g, " ").trim();
  const excerpt = plain.length > 200 ? plain.slice(0, 200) + "..." : plain;

  const categoryLabels = {
    sahitya: "sahitya", rajniti: "rajniti", khel: "khel",
    swasthya: "swasthya", saundarya: "saundarya", fashion: "fashion",
    jeevanshaili: "jeevanshaili", technic: "technic",
    digital: "digital", sthaniya: "sthaniya",
  };
  const catLabel = categoryLabels[category] || category || "general";

  const message = `${title}\n\n${excerpt}\n\nCategory: ${catLabel}\n${postUrl ? `\nRead more: ${postUrl}\n` : ""}\n#VaakRicha #HindiSahitya`;

  try {
    const res = await fetch(MAKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, message, postUrl, category: catLabel, excerpt }),
    });
    if (res.ok) {
      console.log("[Make.com] Webhook sent successfully!");
      return { success: true };
    } else {
      console.error("[Make.com] Webhook failed:", res.status);
      return { success: false };
    }
  } catch (e) {
    console.error("[Make.com] Webhook error:", e);
    return { success: false };
  }
}

async function verifyIdentityToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || "";
  try {
    const res = await fetch(`${siteUrl}/.netlify/identity/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function handler(req, context) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
    });
  }

  const store = getPostsStore(context);

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

  if (action === "createPost") {
    const authHeader = req.headers.get("authorization");
    const user = await verifyIdentityToken(authHeader);
    if (!user) return errorRes("Login required", 401);

    const { title, category, content, image } = body;
    if (!title || !category || !content) return errorRes("Title, category and content required");

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

    const siteUrl = process.env.URL || process.env.DEPLOY_URL || "";
    postToFacebookViaMake({
      title: post.title,
      content: post.content,
      category: post.category,
      postId: post.id,
      siteUrl,
    }).then((result) => {
      if (result && result.success) {
        console.log(`[Make.com] "${post.title}" sent to Facebook!`);
      } else {
        console.warn("[Make.com] Could not send to Facebook.");
      }
    }).catch((e) => console.error("[Make.com] Exception:", e));

    return jsonRes({ post }, 201);
  }

  if (action === "verifyPin") {
    const { pin } = body;
    return jsonRes({ ok: checkPin(pin) });
  }

  if (action === "editPost") {
    const { pin, postId, title, category, content, image } = body;
    if (!checkPin(pin)) return errorRes("Wrong pin", 403);
    const posts = await loadPosts(store);
    const idx = posts.findIndex((p) => p.id === postId);
    if (idx === -1) return errorRes("Post not found", 404);
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

  if (action === "deletePost") {
    const { pin, postId } = body;
    if (!checkPin(pin)) return errorRes("Wrong pin", 403);
    const posts = await loadPosts(store);
    await savePosts(store, posts.filter((p) => p.id !== postId));
    return jsonRes({ ok: true });
  }

  if (action === "like") {
    const { postId } = body;
    const posts = await loadPosts(store);
    const p = posts.find((x) => x.id === postId);
    if (!p) return errorRes("Post not found", 404);
    p.likes = (p.likes || 0) + 1;
    await savePosts(store, posts);
    return jsonRes({ likes: p.likes });
  }

  if (action === "addComment") {
    const { postId, name, text } = body;
    if (!postId || !name || !text) return errorRes("All fields required");
    const posts = await loadPosts(store);
    const p = posts.find((x) => x.id === postId);
    if (!p) return errorRes("Post not found", 404);
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

  if (action === "deleteComment") {
    const { pin, postId, commentId } = body;
    if (!checkPin(pin)) return errorRes("Wrong pin", 403);
    const posts = await loadPosts(store);
    const p = posts.find((x) => x.id === postId);
    if (!p) return errorRes("Post not found", 404);
    p.comments = (p.comments || []).filter((c) => c.id !== commentId);
    await savePosts(store, posts);
    return jsonRes({ ok: true });
  }

  if (action === "addReply") {
    const { postId, commentId, name, text } = body;
    if (!postId || !commentId || !name || !text) return errorRes("All fields required");
    const posts = await loadPosts(store);
    const p = posts.find((x) => x.id === postId);
    if (!p) return errorRes("Post not found", 404);
    const c = (p.comments || []).find((x) => x.id === commentId);
    if (!c) return errorRes("Comment not found", 404);
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

  if (action === "deleteReply") {
    const { pin, postId, commentId, replyId } = body;
    if (!checkPin(pin)) return errorRes("Wrong pin", 403);
    const posts = await loadPosts(store);
    const p = posts.find((x) => x.id === postId);
    if (!p) return errorRes("Post not found", 404);
    const c = (p.comments || []).find((x) => x.id === commentId);
    if (!c) return errorRes("Comment not found", 404);
    c.replies = (c.replies || []).filter((r) => r.id !== replyId);
    await savePosts(store, posts);
    return jsonRes({ ok: true });
  }

  return errorRes("Unknown action: " + action);
}

export const config = { path: "/.netlify/functions/api" };
