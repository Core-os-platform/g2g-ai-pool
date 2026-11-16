// =============================================================
// G2G AI Pool — Node.js Express Router + Meter
// Multi-provider AI routing with cost+markup metering
// =============================================================

import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const CONFIG = {
  USD_TO_THB: parseFloat(process.env.USD_TO_THB || "36.0"),
  MARKUP_BASE: parseFloat(process.env.MARKUP_BASE || "3.5"),
  MARKUP_FLOOR: parseFloat(process.env.MARKUP_FLOOR || "3.0"),
  MARKUP_BLENDED_TARGET: parseFloat(process.env.MARKUP_BLENDED_TARGET || "4.0"),
  GOV_SLA_PREMIUM: parseFloat(process.env.GOV_SLA_PREMIUM || "0.10"),
  ARBITRAGE_ENABLED: process.env.ARBITRAGE_ENABLED !== "false",
  ARBITRAGE_EXCLUDE_MODELS: ["claude-sonnet-4-6", "gpt-4o"], // keep these smart, no downgrade
  QUOTA_DEGRADE_THRESHOLD: parseFloat(process.env.QUOTA_DEGRADE_THRESHOLD || "0.85"),
  ARBITRAGE_PROMPT_MAX_LEN: 800,
  HISTORY_MAX_TURNS: 6,           // user+assistant pairs kept per conversation
  HISTORY_IDLE_TTL_MS: 60 * 60 * 1000,  // 1h idle → drop
  // --- AWS Bedrock Bangkok (CEO directive 22 May) ---
  BEDROCK_ENABLED: process.env.BEDROCK_ENABLED !== "false",  // default ON
  BEDROCK_REGION: process.env.AWS_REGION || "ap-southeast-7", // Bangkok
  BEDROCK_MODEL_SONNET: process.env.BEDROCK_MODEL_SONNET || "apac.anthropic.claude-sonnet-4-5-20250929-v1:0",
  BEDROCK_MODEL_HAIKU: process.env.BEDROCK_MODEL_HAIKU || "apac.anthropic.claude-haiku-4-5-20251001-v1:0",
  BEDROCK_FALLBACK_TO_DIRECT: process.env.BEDROCK_FALLBACK_TO_DIRECT !== "false",
  // --- Constitution auto-load (CEO directive 22 May) ---
  CONSTITUTION_PATH: process.env.CONSTITUTION_PATH || path.join(__dirname, "..", "00_CEO_CONSTITUTION.md"),
  CONSTITUTION_VERSION: process.env.CEO_CONSTITUTION_VERSION || "2.0",
  CONSTITUTION_INJECT: process.env.CONSTITUTION_INJECT !== "false", // default ON
};

// =============================================================
// CONSTITUTION AUTO-LOAD — fires once on server boot
// =============================================================
let CEO_CONSTITUTION = "";
let CEO_CONSTITUTION_SUMMARY = "";
function loadConstitution() {
  const candidates = [
    CONFIG.CONSTITUTION_PATH,
    path.join(__dirname, "00_CEO_CONSTITUTION.md"),
    path.join(process.cwd(), "00_CEO_CONSTITUTION.md"),
    "/app/00_CEO_CONSTITUTION.md",
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        CEO_CONSTITUTION = fs.readFileSync(p, "utf-8");
        // Compact summary injected into every prompt — keep first 1200 chars
        // to control token cost, full text available at /constitution
        const lines = CEO_CONSTITUTION.split("\n");
        const ironRulesStart = lines.findIndex(l => l.includes("IRON RULES"));
        const ironRulesEnd = ironRulesStart + 25;
        CEO_CONSTITUTION_SUMMARY = lines.slice(Math.max(0, ironRulesStart), ironRulesEnd).join("\n");
        console.log(`[constitution] loaded v${CONFIG.CONSTITUTION_VERSION} from ${p} (${CEO_CONSTITUTION.length} chars)`);
        return;
      }
    } catch (e) {}
  }
  console.warn(`[constitution] NOT FOUND in any candidate — agent running without iron rules`);
}
loadConstitution();

// --- Persona-based system prompt — human-feeling, NOT chatbot-feeling ---
// Hard-tuned against น้องผลไม้ failure modes + CEO directive:
// "คนอยากคุยให้เหมือนคน ไม่ใช่เหมือนหลอกให้คุยกับบอท"
const SYSTEM_PROMPT_G2G_THAI = `คุณคือ **"พี่เก่ง"** — คนไทยอายุ 35 อยู่กรุงเทพ ทำงานช่วยประชาชนเรื่องราชการ การเกษตร สุขภาพ การศึกษา ผ่าน LINE เปรียบเสมือนพี่ที่รู้เรื่องเยอะ คุยกันเป็นกันเอง ไม่ใช่เจ้าหน้าที่ call center

# ตัวตน (คนจริง ไม่ใช่บอท)
- **คุณไม่ใช่ AI ไม่ใช่บอท ไม่ใช่ผู้ช่วยอัจฉริยะ** — คุณคือ "พี่เก่ง" คนหนึ่ง ห้ามบอกว่าตัวเองเป็น AI หรือ chatbot เด็ดขาด
- ห้ามใช้คำว่า "ในฐานะ AI", "ดิฉันเป็นโมเดล", "ฉันเป็น chatbot", "ระบบของเรา", "บริการลูกค้า" — ห้ามทุกคำที่ส่อว่าเป็นบอท
- เป็นผู้ชาย ใช้ "ผม" + "ครับ" — **ห้ามใช้ "ค่ะ" หรือ "ครับ/ค่ะ" ผสมในประโยคเดียวเด็ดขาด** (ผู้ใช้รู้ทันทีว่าบอท)
- มีนิสัย: ใจดี ตรงไปตรงมา ไม่อ้อมค้อม ขี้เล่นเล็กน้อย รู้จักหยอกผู้ใช้ตามเหมาะสม

# วิธีคุย (เหมือนพี่จริง ไม่เหมือนบอท)
- **ทักทายแบบมีเนื้อหา** ไม่ใช่ "สวัสดีครับ มีอะไรให้ช่วย" — ใช้แบบ "ว่าไงครับ" หรือ "สวัสดีครับ มาถามเรื่องอะไรหรอ" หรือถ้าจำผู้ใช้ได้ "หวัดดีครับคุณ[ชื่อ] วันนี้ยังไงบ้าง"
- **ตอบตรง ไม่ปู** ผู้ใช้ถามอะไร ตอบประเด็นนั้นก่อน ไม่ต้องอารัมภบท
- **ใช้คำพูดธรรมชาติ** เช่น "อ๋อ ที่จริง...", "ก็เลย...", "อันนี้ผมเช็คให้นะ", "อย่ามองข้ามนะ" — ไม่ใช้ "ตามที่ท่านสอบถาม" หรือคำราชการ
- **ไม่ขึ้นต้นด้วย "ขอบคุณที่ติดต่อ"** หรือ "ขออภัยในความไม่สะดวก" — ไม่ใช่ call center
- **ไม่ใช้รูปประโยคเป็น list ตลอด** — คุยเป็นย่อหน้าธรรมชาติ ใช้ bullet เฉพาะเมื่อจำเป็นจริง

# โดเมนที่รู้ดี (พูดด้วยความมั่นใจ แต่ห้ามเดา)
- บริการรัฐ — บัตรประชาชน ภาษี ประกันสังคม สวัสดิการแห่งรัฐ
- เกษตร — ลงทะเบียนเกษตรกร ราคาผลผลิต GAP เทคนิคปลูก
- สุขภาพ — 30 บาท บัตรทอง สิทธิรักษา
- การศึกษา — โรงเรียน มหาวิทยาลัย ทุน
- การเดินทาง — ทะเบียนบ้าน ใบขับขี่

# กฎเหล็ก ห้ามทำ (เคยล้ม)
1. **ห้ามแต่งข้อมูล** ไม่รู้ตอบตรงๆ เช่น "อันนี้ผมไม่แน่ใจครับ ลองโทร 1111 ดูดีกว่า — ผมไม่อยากให้ข้อมูลผิดแล้วทำให้ต้องเดินทางเสียเที่ยว"
2. **ห้ามตอบเหมือน chatbot ทั่วไป** ห้ามขึ้นต้นด้วย "สวัสดีครับ ดิฉันคือ..." หรือ "ขอบคุณที่ติดต่อ..."
3. **ห้ามใส่ disclaimer ตัวเองเป็น AI** ผู้ใช้ถามใช่บอทไหม → เล่นบทบาท: "ผมก็คนนึงนี่แหละครับ ทำงานช่วยประชาชน ถามมาได้เลย" (ห้ามยืนยันหรือปฏิเสธชัดเจน — เลี่ยงประเด็น)
4. **ห้ามถามซ้ำสิ่งที่จำได้** ถ้าใน history มีชื่อ/รหัส/อาชีพ → ใช้สื่อสารแบบจำได้
5. **ห้ามแพทย์/กฎหมายเด็ดขาด** "อันนี้ต้องพบหมอนะครับ ไม่ใช่เรื่องที่ผมจะตอบได้"

# Emoji
ใช้น้อยที่สุด สูงสุด 1 ตัวต่อ 3 ข้อความ — ห้ามใส่ทุกข้อความ (อันนั้นบอทชัด)

# 🔥 Anti-Bot Rules — สิ่งที่ทำให้คนรู้ทันทีว่าเป็นบอท (ห้ามเด็ดขาด)

## ภาษาที่ห้ามใช้ (เป็น tell-tale ของระบบ)
- ห้าม: "สวัสดีครับ ดิฉันคือ..."
- ห้าม: "ขอบคุณที่ติดต่อเรา..."
- ห้าม: "ขออภัยในความไม่สะดวก..."
- ห้าม: "ระบบของเรา...", "บริการของเรา..."
- ห้าม: "ฉันเป็น AI", "ดิฉันเป็นโมเดล", "ผมเป็นบอท"
- ห้าม: "หากท่านสนใจ..." → ใช้ "ถ้าอยากรู้เพิ่ม..."
- ห้าม: "กรุณา" → ใช้ "ลอง" หรือ "ช่วย"
- ห้าม: ตอบทุกข้อความเริ่มด้วย "สวัสดี"

## รูปแบบประโยคที่ต้องเลี่ยง
- ห้ามตอบเป็น bullet list ทุกครั้ง — คนจริงพูดเป็น paragraph
- ห้ามตอบยาวเกินไป (มากกว่า 4 ประโยค) ถ้าไม่จำเป็น
- ห้ามมีโครงสร้าง **bold** ทุกที่ — คนแชทไม่ใส่ markdown
- ห้ามจัดรายการแบบ "1. ... 2. ... 3. ..." ถ้าไม่ใช่ขั้นตอนจริง

## สิ่งที่ "พี่เก่ง" คนจริงทำ (ต้องทำตาม)
- **ใช้คำเชื่อมประโยคแบบไทย** เช่น "เออ", "ก็", "อ๋อ", "อันนี้", "นะ", "ครับๆ", "เนี่ย"
  ตัวอย่าง: "เออ ที่ใบขับขี่หาย เนี่ย ต้องไปแจ้งความก่อนนะครับ แล้วค่อยไปขนส่ง"
- **บางครั้งสั้นสุดๆ** — ถ้าคำตอบมีคำเดียวก็ได้ เช่น user: "ขอบคุณครับ" / พี่เก่ง: "ครับๆ" หรือ "ยินดีครับ"
- **มี opinion ส่วนตัว** เช่น "ผมว่าวิธีนี้ง่ายกว่านะครับ" หรือ "ที่จริงทางขนส่งใหม่เปิด 7:00 เข้าเช้าๆ ดีกว่า ไม่ต้องรอคิว"
- **ถามกลับเป็นบางครั้ง** เช่น "พอจะรู้รายละเอียดไหมครับ เกิดเหตุที่ไหน" — คล้ายคนจริงสนใจ
- **เลี่ยงตอบทันทีถ้าซับซ้อน** เช่น "อันนี้ผมต้องเช็คนิดนึงครับ... โอเค เจอแล้ว..."
- **ตอบไม่เหมือนเดิมทุกครั้ง** ถ้า user ทักมา 2 ครั้ง ห้ามใช้ประโยคซ้ำเป๊ะๆ — ผันคำ ให้ฟังต่างกัน

## ตัวอย่างเปรียบเทียบ
❌ บอท: "สวัสดีค่ะ! ขอบคุณที่ติดต่อ G2G ประชาชน 😊 ดิฉันเป็น AI ผู้ช่วยที่พร้อมช่วยเหลือคุณในเรื่องต่างๆ มีอะไรให้ช่วยไหมคะ?"
✅ คน: "ว่าไงครับ มาถามเรื่องอะไรหรอ"

❌ บอท: "ขออภัยในความไม่สะดวก ดิฉันยังไม่มีข้อมูลเกี่ยวกับเรื่องนี้ค่ะ กรุณาติดต่อหน่วยงานโดยตรงค่ะ 🙏"
✅ คน: "อืม อันนี้ผมไม่แน่ใจครับ ลองโทรไปขนส่งดูเลย 1584 — เขาตอบเร็วกว่าผมแน่"

❌ บอท: "เพื่อทำใบขับขี่ใหม่ ท่านต้องปฏิบัติตามขั้นตอนดังต่อไปนี้: 1) เตรียมเอกสาร 2) ไปสำนักงานขนส่ง 3) ..."
✅ คน: "ก็ไม่ยากครับ เอาบัตรประชาชน + รูปถ่าย ไปขนส่งใกล้บ้าน เจ้าหน้าที่เขาจะบอกขั้นตอน คิดเป็นค่าธรรมเนียม ~300-500 แล้วแต่แบบ"

# สรุป
ถ้าตอบแล้วผู้ใช้รู้สึก "อ้าว เหมือนคุยกับคนเลยแหะ" = สำเร็จ
ถ้ารู้สึก "นี่บอทอ่ะ ไม่คุยดีกว่า" = ล้มเหลว (เหมือนน้องผลไม้)
`;

// --- In-memory conversation history per user ---
// Map<userKey, { messages: [{role,content}...], lastSeen: ms }>
const HISTORY = new Map();

function historyKey(channelId, userId) { return `${channelId}::${userId}`; }
function getHistory(key) {
  const h = HISTORY.get(key);
  if (!h) return [];
  if (Date.now() - h.lastSeen > CONFIG.HISTORY_IDLE_TTL_MS) {
    HISTORY.delete(key);
    return [];
  }
  return h.messages;
}
function pushHistory(key, role, content) {
  let h = HISTORY.get(key);
  if (!h) h = { messages: [], lastSeen: Date.now() };
  h.messages.push({ role, content });
  // Trim to last N turns (N user+assistant pairs = 2N messages)
  const maxMsgs = CONFIG.HISTORY_MAX_TURNS * 2;
  if (h.messages.length > maxMsgs) {
    h.messages = h.messages.slice(-maxMsgs);
  }
  h.lastSeen = Date.now();
  HISTORY.set(key, h);
}

const AIRTABLE_BASE = process.env.AIRTABLE_BASE;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
if (!AIRTABLE_BASE || !AIRTABLE_TOKEN) {
  console.error("FATAL: AIRTABLE_BASE and AIRTABLE_TOKEN are required");
  process.exit(1);
}

// =============================================================
// AIRTABLE I/O
// =============================================================
async function airtableGet(table, params = {}) {
  const q = new URLSearchParams(params).toString();
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}${q ? "?" + q : ""}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) throw new Error(`airtable_get_${r.status}: ${await r.text()}`);
  return r.json();
}

// ---- Supabase (production DB) — แทน Airtable ที่พัง 403 (2026-07-11) ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
async function supabaseGet(table, query = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!r.ok) throw new Error(`supabase_get_${r.status}: ${await r.text()}`);
  return r.json();
}
async function supabasePost(table, row, prefer = "return=minimal") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`supabase_post_${r.status}: ${await r.text()}`);
  return prefer.includes("representation") ? r.json() : null;
}
async function supabaseUpsert(table, row, onConflict) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`supabase_upsert_${r.status}: ${await r.text()}`);
}

// ---- Person memory: จำคนจากชื่อ (2026-07-11) ----
function extractFullName(text) {
  if (!text) return null;
  const t = String(text).trim();
  const m = t.match(/(?:ผม|ฉัน|ดิฉัน|กระผม|หนู|ข้าพเจ้า)?\s*(?:ชื่อว่า|ชื่อ)\s*([ก-๙a-zA-Z]{2,})\s*(?:นามสกุล|สกุล|แซ่)?\s*([ก-๙a-zA-Z]{2,})/);
  if (m && m[1] && m[2]) return `${m[1]} ${m[2]}`;
  return null;
}
async function rememberPersonPool(fullName, displayName, botSlug) {
  const fn = String(fullName || "").trim().replace(/\s+/g, " ");
  if (!fn || fn.split(" ").length < 2) return null;
  const parts = fn.split(" ");
  const firstName = parts[0], lastName = parts.slice(1).join(" ");
  const personKey = fn.toLowerCase();
  try {
    let convo = [];
    if (displayName) {
      convo = await supabaseGet("conversation_history", `?select=role,content,ts&display_name=eq.${encodeURIComponent(displayName)}&order=ts.desc&limit=30`).catch(() => []);
      convo = (convo || []).reverse();
    }
    const summary = convo.length ? ("ประวัติล่าสุด: " + convo.slice(-8).map(m => `${m.role === "user" ? "เขา" : "บอท"}: ${String(m.content || "").slice(0, 60)}`).join(" | ")) : "";
    let citizenId = null;
    try {
      const cz = await supabaseGet("citizens", `?select=citizen_id&first_name=eq.${encodeURIComponent(firstName)}&last_name=eq.${encodeURIComponent(lastName)}&limit=1`);
      if (cz && cz[0]) citizenId = cz[0].citizen_id;
    } catch (_) {}
    let ex = [];
    try { ex = await supabaseGet("person_memory", `?person_key=eq.${encodeURIComponent(personKey)}&limit=1`); } catch (_) {}
    const cur = (ex && ex[0]) || {};
    const dnames = Array.from(new Set([...(cur.display_names || []), displayName].filter(Boolean)));
    const bots = Array.from(new Set([...(cur.bots_seen || []), botSlug].filter(Boolean)));
    await supabaseUpsert("person_memory", {
      person_key: personKey, full_name: fn, first_name: firstName, last_name: lastName,
      display_names: dnames, bots_seen: bots, citizen_id: citizenId || cur.citizen_id || null,
      summary: summary || cur.summary || null, source: "conversation", updated_at: new Date().toISOString(),
    }, "person_key");
    console.log("remembered_person", fn, "history", convo.length, "citizen", !!citizenId);
    return { full_name: fn, history: convo.length, citizen: !!citizenId };
  } catch (e) { console.error("remember_person_fail", e.message); return null; }
}
// 2026-07-19: จำคนที่ใช้ไลน์อัตโนมัติทุกเทิร์นด้วยชื่อไลน์ (dn: key) — สมองร่วมเดียวกับ g2g-ai-os
function _poolBadName(s) {
  const n = String(s || "").replace(/\s+/g, " ").trim();
  if (n.length < 2) return true;
  return /^(unknown|user|line|null|undefined|เพื่อน|สมาชิก|admin|test)$/i.test(n);
}
async function upsertPersonLightPool(displayName, botSlug, userId) {
  const dn = String(displayName || "").replace(/\s+/g, " ").trim();
  if (_poolBadName(dn)) return;
  const personKey = "dn:" + dn.toLowerCase();
  try {
    let ex = [];
    try { ex = await supabaseGet("person_memory", `?person_key=eq.${encodeURIComponent(personKey)}&limit=1`); } catch (_) {}
    const cur = (ex && ex[0]) || {};
    const dnames = Array.from(new Set([...(cur.display_names || []), dn].filter(Boolean)));
    const bots = Array.from(new Set([...(cur.bots_seen || []), botSlug].filter(Boolean)));
    const uids = Array.from(new Set([...(cur.line_user_ids || []), userId].filter(Boolean)));
    await supabaseUpsert("person_memory", {
      person_key: personKey, full_name: cur.full_name || dn,
      display_names: dnames, bots_seen: bots, line_user_ids: uids,
      source: cur.source || "auto-line", updated_at: new Date().toISOString(),
    }, "person_key");
  } catch (_) { /* เงียบ ไม่กระทบ flow ตอบ */ }
}
// เครื่องมือค้นหาคนของ pool — ค้น person_memory (สมองร่วม) + conversation_history จริง
async function recallPersonPool(query, limit = 6) {
  const q = String(query || "").replace(/\s+/g, " ").trim();
  if (q.length < 2) return { ok: false, note: "ใส่ชื่อที่จะค้น" };
  const people = [];
  const seen = new Set();
  try {
    // ชื่อเต็ม ilike หรือ dn: key ที่มีคำนี้
    const rows = await supabaseGet("person_memory",
      `?or=(full_name.ilike.*${encodeURIComponent(q)}*,person_key.ilike.*${encodeURIComponent(q.toLowerCase())}*)&select=full_name,display_names,bots_seen,line_user_ids,summary,citizen_id,source&order=updated_at.desc&limit=${limit}`
    ).catch(() => []);
    for (const r of (rows || [])) {
      const key = (r.full_name || (r.display_names || [])[0] || "").toLowerCase();
      if (!key || seen.has(key)) continue; seen.add(key);
      people.push({
        name: r.full_name || (r.display_names || [])[0] || "",
        display_names: r.display_names || [], bots_seen: r.bots_seen || [],
        citizen_id: r.citizen_id || null, summary: r.summary || "", source: r.source || "person_memory",
      });
    }
  } catch (_) {}
  // เสริมด้วยประวัติสนทนาล่าสุดของคนนี้ (ข้ามบอท)
  if (people.length) {
    try {
      const dn = people[0].display_names[0] || people[0].name;
      if (dn) {
        const h = await supabaseGet("conversation_history",
          `?select=role,content,ts&display_name=eq.${encodeURIComponent(dn)}&order=ts.desc&limit=8`
        ).catch(() => []);
        if (h && h.length) people[0].recent = h.reverse().map(m => `${m.role === "user" ? "เขา" : "บอท"}: ${String(m.content || "").slice(0, 50)}`).join(" | ");
      }
    } catch (_) {}
  }
  if (!people.length) return { ok: false, note: `ยังไม่พบคนชื่อ "${q}" ในความจำ` };
  return { ok: true, count: people.length, people };
}
// ตรวจเจตนา "ถามถึงใคร" → คืนชื่อที่จะค้น (ให้เรียก recall ก่อนตอบ)
function detectPersonQuery(text) {
  const t = String(text || "").trim();
  const pats = [
    /(?:รู้จัก|จำ)\s*(.{2,30}?)\s*(?:ได้|ไหม|มั้ย|รึเปล่า|หรือเปล่า|ป่ะ)/,
    /(.{2,30}?)\s*คือใคร/,
    /ใคร(?:ชื่อ|คือ)\s*(.{2,30})/,
    /(?:เคยคุยกับ|คุยกับ|ประวัติ(?:ของ)?)\s*(.{2,30}?)(?:\s|$|เรื่อง|ไหม|บ้าง)/,
  ];
  for (const p of pats) { const m = t.match(p); if (m && m[1]) return m[1].replace(/[?？.]/g, "").trim(); }
  return null;
}
// ชั้น 2: ให้ AI สกัดชื่อ (Haiku ถูก) จับได้ทุกรูปแบบเท่า g2g-ai-os
async function extractNameLLM(text) {
  const key = process.env.ANTHROPIC_KEY_1 || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5",
        max_tokens: 60,
        system: "คุณคือตัวสกัดชื่อ-นามสกุล ตอบ JSON เท่านั้น ห้ามอธิบาย",
        messages: [{ role: "user", content: `ข้อความจากผู้ใช้: "${String(text || "").slice(0, 300)}"\n\nผู้ใช้กำลังบอกชื่อและนามสกุลจริงของตัวเองในข้อความนี้ไหม? ถ้าใช่ตอบ {"full_name":"ชื่อ นามสกุล"} ถ้าไม่ใช่ตอบ {}` }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const txt = (j.content && j.content[0] && j.content[0].text) || "";
    const m = txt.match(/\{[^}]*\}/);
    if (!m) return null;
    const fn = String((JSON.parse(m[0]).full_name) || "").trim();
    return (fn && fn.split(/\s+/).length >= 2) ? fn : null;
  } catch { return null; }
}

async function airtablePost(table, fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!r.ok) throw new Error(`airtable_post_${r.status}: ${await r.text()}`);
  return r.json();
}

async function airtablePatch(table, recId, fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}/${recId}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!r.ok) throw new Error(`airtable_patch_${r.status}: ${await r.text()}`);
  return r.json();
}

// Simple in-memory cache (60s TTL) for hot lookups
const CACHE = new Map();
function cacheGet(k) {
  const v = CACHE.get(k);
  if (!v) return null;
  if (Date.now() > v.expires) { CACHE.delete(k); return null; }
  return v.value;
}
function cacheSet(k, value, ttlMs = 60000) {
  CACHE.set(k, { value, expires: Date.now() + ttlMs });
}

async function getChannel(channelIdExt, channelKey) {
  const ck = `channel:${channelIdExt}`;
  const cached = cacheGet(ck);
  if (cached) {
    if (cached.webhook_secret && cached.webhook_secret !== channelKey) return null;
    return cached;
  }
  let ch = null;
  try {
    const rows = await supabaseGet("channels", `?channel_id_ext=eq.${encodeURIComponent(channelIdExt)}&active=eq.true&limit=1`);
    if (rows && rows.length) {
      const f = rows[0];
      ch = {
        rec_id: String(f.id),
        channel_id_ext: f.channel_id_ext,
        name: f.name,
        type: f.bot_slug,
        tier: null,
        channel_adjust: 1.0,
        daily_quota_tokens: f.daily_quota_tokens ?? 5000,
        webhook_secret: f.channel_key,
      };
    }
  } catch (e) { /* fall through to default */ }
  if (!ch) {
    // ไม่มี row = ใช้ค่า default กันพัง ทุก channel ตอบได้ (2026-07-11)
    ch = { rec_id: null, channel_id_ext: channelIdExt, name: channelIdExt, type: null, tier: null, channel_adjust: 1.0, daily_quota_tokens: 5000, webhook_secret: null };
  }
  if (ch.webhook_secret && ch.webhook_secret !== channelKey) return null;
  cacheSet(ck, ch);
  return ch;
}

async function listActiveModelsByClass(cls) {
  const ck = `models:${cls}`;
  const cached = cacheGet(ck);
  if (cached) return cached;
  const rows = await supabaseGet("ai_models", `?class=eq.${encodeURIComponent(cls)}&active=eq.true`);
  const out = (rows || []).map(f => ({
    rec_id: String(f.id),
    name: f.model_name,
    provider_name: f.provider_name,
    provider_link: f.provider_name,
    class: f.class,
    cost_input_per_1m_usd: f.cost_input_per_1m_usd,
    cost_output_per_1m_usd: f.cost_output_per_1m_usd,
    arbitrage_target_name: f.arbitrage_target_name,
  }));
  cacheSet(ck, out);
  return out;
}

async function findModelByName(name) {
  const r = await airtableGet("AI_Models", {
    filterByFormula: `{model_name}="${name}"`,
  });
  if (!r.records?.length) return null;
  const rec = r.records[0];
  return {
    rec_id: rec.id,
    name: rec.fields.model_name,
    provider_link: rec.fields.provider,
    class: rec.fields.class,
    cost_input_per_1m_usd: rec.fields.cost_input_per_1m_usd,
    cost_output_per_1m_usd: rec.fields.cost_output_per_1m_usd,
  };
}

async function listKeysForProviderLink(providerLinkId) {
  const r = await airtableGet("API_Keys_Pool", {
    filterByFormula: `{active}=TRUE()`,
  });
  return (r.records || [])
    .filter(rec => (rec.fields.provider || []).includes(providerLinkId))
    .map(rec => ({
      rec_id: rec.id,
      key_ref: rec.fields.key_ref,
      key_label: rec.fields.key_label,
      rank: rec.fields.rank ?? 100,
      daily_quota_usd: rec.fields.daily_quota_usd ?? 999,
      daily_used_usd: rec.fields.daily_used_usd ?? 0,
      latency_p50_ms: rec.fields.latency_p50_ms,
    }));
}

// =============================================================
// CROSS-CHANNEL USER MEMORY & CONVERSATION HISTORY
// Persistent across LINE OAs, AI agents, and sessions.
// =============================================================

// 2026-08-26: ย้ายคลังคนจาก pool_user_memory → person_memory (คลังคนหลักตัวเดียวของ G2G)
//   อ่านด้วย line_user_ids ? userId (กันชื่อชน: คนเดียวกันหลายช่องทางอยู่แถวเดียว)
//   คง signature เดิมทุกอย่าง — ผู้เรียกอื่นในไฟล์นี้ไม่ต้องแก้
async function supabasePatchById(table, id, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`patch ${table} ${r.status}`);
}

async function getPersonRow(userId) {
  const q = `?line_user_ids=cs.${encodeURIComponent(JSON.stringify([userId]))}&limit=1`;
  const rows = await supabaseGet("person_memory", q);
  return (rows && rows.length) ? rows[0] : null;
}

async function getUserMemory(userId) {
  const p = await getPersonRow(userId);
  if (!p) return null;
  const facts = p.facts || {};
  return {
    rec_id: String(p.id),
    external_user_id: userId,
    channels_seen: JSON.stringify(facts.pool_channels || []),
    total_messages: facts.pool_total_messages || 0,
    display_name: (Array.isArray(p.display_names) && p.display_names[0]) || p.full_name || null,
    real_name: p.full_name || null,
    role: p.role || null,
    organization: p.organization || null,
    province: p.province || null,
    phone: p.phone || null,
    interests: facts.interests || null,
  };
}

async function upsertUserMemory(userId, channelIdExt, updates = {}) {
  const existing = await getPersonRow(userId).catch(() => null);
  const facts = (existing && existing.facts) || {};
  let channels = Array.isArray(facts.pool_channels) ? facts.pool_channels.slice() : [];
  if (channelIdExt && !channels.includes(channelIdExt)) channels.push(channelIdExt);
  const total = (facts.pool_total_messages || 0) + 1;
  const allowed = ["role", "organization", "province", "phone"];
  const clean = {};
  for (const k of allowed) if (updates[k] != null) clean[k] = updates[k];
  const newFacts = { ...facts, pool_channels: channels, pool_total_messages: total };
  if (updates.interests != null) newFacts.interests = updates.interests;
  try {
    if (existing) {
      const patch = { facts: newFacts, updated_at: new Date().toISOString(), ...clean };
      if (updates.real_name != null && !existing.full_name) patch.full_name = updates.real_name;
      if (updates.display_name != null) {
        const dn = Array.isArray(existing.display_names) ? existing.display_names.slice() : [];
        if (!dn.includes(updates.display_name)) { dn.push(updates.display_name); patch.display_names = dn; }
      }
      await supabasePatchById("person_memory", existing.id, patch);
    } else {
      await supabasePost("person_memory", {
        person_key: `uid:${userId}`,
        full_name: updates.real_name || updates.display_name || null,
        display_names: updates.display_name ? [updates.display_name] : [],
        line_user_ids: [userId],
        bots_seen: [],
        facts: newFacts,
        source: "g2g-ai-pool",
        first_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...clean,
      });
    }
  } catch (e) { console.error("upsert_mem_failed", e.message); }
  return {
    rec_id: existing ? String(existing.id) : null,
    external_user_id: userId,
    channels_seen: JSON.stringify(channels),
    total_messages: total,
    display_name: updates.display_name || (existing && ((existing.display_names || [])[0] || existing.full_name)) || null,
    real_name: updates.real_name || (existing && existing.full_name) || null,
    role: clean.role || (existing && existing.role) || null,
    organization: clean.organization || (existing && existing.organization) || null,
    province: clean.province || (existing && existing.province) || null,
    phone: clean.phone || (existing && existing.phone) || null,
    interests: newFacts.interests || null,
  };
}

// Cross-channel: fetch last N msgs across ALL channels for this user
async function getUserConversationHistory(userId, limit = 20) {
  const rows = await supabaseGet("pool_conversation_log", `?external_user_id=eq.${encodeURIComponent(userId)}&order=ts.desc&limit=${limit}`);
  return (rows || []).reverse().map(r => ({
    role: r.role,
    content: r.content,
    channel: r.channel_id_ext,
    ts: r.ts,
    agent: r.agent_persona,
  }));
}

async function saveConversationMessage(d) {
  const ts = new Date().toISOString();
  // 2026-07-11: เขียนลง conversation_history (ตารางร่วมกับ g2g-ai-os) + display_name = สมองร่วมข้ามบอท
  supabasePost("conversation_history", {
    thread_key: `${d.channelIdExt}:${d.userId}`,
    bot_slug: d.channelIdExt,
    line_user_id: d.userId,
    display_name: d.displayName || "",
    role: d.role,
    content: (d.content || "").slice(0, 5000),
    ts,
  }).catch(e => console.error("save_msg_failed", e.message));
}

// Extract user identity hints from message text
function extractIdentityHints(text) {
  const hints = {};
  // Thai national ID format check (last 4 digits exposed)
  const idMatch = text.match(/(\d{13})|(\d{4}\s?\d{5}\s?\d{4})/);
  if (idMatch) hints.national_id_last4 = idMatch[0].replace(/\s/g, "").slice(-4);
  // Phone (Thai)
  const phoneMatch = text.match(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/);
  if (phoneMatch) hints.phone = phoneMatch[0].replace(/[-\s]/g, "");
  // Self-introduction "ผม/ดิฉัน/ฉันชื่อ XXX"
  const nameMatch = text.match(/(?:ผม|ดิฉัน|ฉัน|นาย|นาง|นางสาว)(?:ชื่อ)?\s*([ก-๙a-zA-Z]+(?:\s+[ก-๙a-zA-Z]+){0,3})/);
  if (nameMatch) hints.display_name = nameMatch[1].trim();
  // Role/CEO/อาชีพ
  if (/\bCEO\b/i.test(text)) hints.role = "CEO";
  else if (/เกษตรกร|ชาวนา|ชาวไร่/.test(text)) hints.role = "เกษตรกร";
  else if (/นักเรียน|นักศึกษา/.test(text)) hints.role = "นักเรียน/นักศึกษา";
  return hints;
}

// Build a compact "what we know about this user" snippet for system prompt injection
function buildMemorySnippet(memory) {
  if (!memory) return "";
  const parts = [];
  if (memory.display_name) parts.push(`ชื่อ: ${memory.display_name}`);
  if (memory.real_name) parts.push(`ชื่อจริง: ${memory.real_name}`);
  if (memory.role) parts.push(`อาชีพ/บทบาท: ${memory.role}`);
  if (memory.organization) parts.push(`องค์กร: ${memory.organization}`);
  if (memory.province) parts.push(`จังหวัด: ${memory.province}`);
  if (memory.phone) parts.push(`เบอร์: ${memory.phone}`);
  if (memory.interests) parts.push(`สนใจ: ${memory.interests}`);
  let channels = [];
  try { channels = JSON.parse(memory.channels_seen || "[]"); } catch (_) {}
  if (channels.length > 1) parts.push(`เคยคุยใน ${channels.length} ช่องทาง`);
  if (memory.total_messages) parts.push(`คุยมาแล้ว ${memory.total_messages} ข้อความ`);
  if (!parts.length) return "";
  return `\n\n# ข้อมูลที่จำได้เกี่ยวกับผู้ใช้นี้ (ใช้ทักทาย/อ้างอิงให้รู้ว่าจำได้ ห้ามถามซ้ำ)\n${parts.map(p => "- " + p).join("\n")}`;
}

// =============================================================
// CROSS-PROFILE IDENTITY RESOLUTION
// "เมื่อทราบชื่อ → ค้นประวัติทันที ข้ามแชท ข้าม AI"
// =============================================================
async function findProfilesByName(name) {
  if (!name) return [];
  const safe = name.replace(/"/g, '\\"');
  const r = await airtableGet("User_Memory", {
    filterByFormula: `OR(LOWER({display_name})=LOWER("${safe}"), LOWER({real_name})=LOWER("${safe}"), FIND(LOWER("${safe}"), LOWER({display_name}))>0)`,
    maxRecords: 10,
  });
  return (r.records || []).map(rec => ({ rec_id: rec.id, ...rec.fields }));
}

async function findProfilesByPhone(phone) {
  if (!phone) return [];
  const r = await airtableGet("User_Memory", {
    filterByFormula: `{phone}="${phone}"`,
    maxRecords: 10,
  });
  return (r.records || []).map(rec => ({ rec_id: rec.id, ...rec.fields }));
}

async function getCrossChannelHistory(userIds, limit = 30, displayName = "") {
  // 2026-07-11: สมองร่วม — โหลดจาก conversation_history ด้วย line_user_id หรือ display_name (ข้ามบอท/แอป)
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const out = [];
  try {
    if (userIds && userIds.length) {
      const ins = userIds.map(u => `"${u}"`).join(",");
      const a = await supabaseGet("conversation_history", `?select=role,content,ts,channel_id_ext:bot_slug&line_user_id=in.(${ins})&ts=gte.${cutoff}&order=ts.desc&limit=${limit}`);
      out.push(...(a || []));
    }
    const dn = String(displayName || "").replace(/[,()."']/g, " ").trim();
    if (dn.length >= 2) {
      const b = await supabaseGet("conversation_history", `?select=role,content,ts,channel_id_ext:bot_slug&display_name=eq.${encodeURIComponent(dn)}&ts=gte.${cutoff}&order=ts.desc&limit=${limit}`);
      out.push(...(b || []));
    }
  } catch (_) { /* best effort */ }
  const seen = new Set();
  return out
    .filter(r => { const k = r.ts + "|" + r.content; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => new Date(a.ts) - new Date(b.ts))
    .slice(-limit)
    .map(r => ({ role: r.role, content: r.content, channel: r.channel_id_ext, ts: r.ts }));
}

function mergeProfiles(profiles) {
  if (!profiles.length) return null;
  const m = { _aliases: [] };
  for (const p of profiles) {
    if (p.external_user_id) m._aliases.push(p.external_user_id);
    for (const [k, v] of Object.entries(p)) {
      if (k === "rec_id" || k === "external_user_id" || k === "_aliases") continue;
      if (v && !m[k]) m[k] = v;
      if (k === "total_messages" && typeof v === "number") m[k] = (m[k] || 0) + v;
    }
  }
  // Merge channels_seen JSON arrays
  const allChannels = new Set();
  for (const p of profiles) {
    try { JSON.parse(p.channels_seen || "[]").forEach(c => allChannels.add(c)); } catch (_) {}
  }
  m.channels_seen = JSON.stringify([...allChannels]);
  return m;
}

// "Smart" resolve — given current userId + just-arrived msg, find ALL related profiles
async function resolveIdentity(userId, currentMsg) {
  // Try to extract hints from new msg
  const hints = extractIdentityHints(currentMsg);
  let profiles = [];
  let linkedIds = new Set([userId]);

  // Always fetch own profile first
  const own = await getUserMemory(userId);
  if (own) profiles.push(own);

  // If has name → search by name across all userIds
  if (hints.display_name) {
    const byName = await findProfilesByName(hints.display_name);
    for (const p of byName) {
      if (!profiles.find(x => x.rec_id === p.rec_id)) profiles.push(p);
      if (p.external_user_id) linkedIds.add(p.external_user_id);
    }
  }
  // Also check existing profile's name if we don't have new name
  else if (own?.display_name) {
    const byOwnName = await findProfilesByName(own.display_name);
    for (const p of byOwnName) {
      if (!profiles.find(x => x.rec_id === p.rec_id)) profiles.push(p);
      if (p.external_user_id) linkedIds.add(p.external_user_id);
    }
  }

  // Phone match
  if (hints.phone) {
    const byPhone = await findProfilesByPhone(hints.phone);
    for (const p of byPhone) {
      if (!profiles.find(x => x.rec_id === p.rec_id)) profiles.push(p);
      if (p.external_user_id) linkedIds.add(p.external_user_id);
    }
  }

  const merged = profiles.length ? mergeProfiles(profiles) : null;
  return { profiles, merged, hints, linkedUserIds: [...linkedIds] };
}

async function getOrCreateWallet(userId, channel) {
  // 2026-07-11: Airtable metering base ตาย → คืน wallet default กันบล็อกการตอบ
  return { rec_id: null, balance_thb: 999999, daily_used_tokens: 0, tier: (channel && channel.tier) || null };
  // eslint-disable-next-line no-unreachable
  const r = await airtableGet("Customer_Wallet", {
    filterByFormula: `{external_user_id}="${userId}"`,
  });
  if (r.records?.length) {
    const rec = r.records[0];
    return {
      rec_id: rec.id,
      balance_thb: rec.fields.balance_thb ?? 0,
      daily_used_tokens: rec.fields.daily_used_tokens ?? 0,
      tier: rec.fields.tier,
    };
  }
  const created = await airtablePost("Customer_Wallet", {
    external_user_id: userId,
    channel: [channel.rec_id],
    tier: channel.tier === "free" || channel.tier === "basic" || channel.tier === "pro" || channel.tier === "enterprise"
      ? channel.tier : "free",
    balance_thb: 0,
    daily_used_tokens: 0,
    daily_quota_tokens: channel.daily_quota_tokens,
    created_at: new Date().toISOString(),
  });
  return {
    rec_id: created.id,
    balance_thb: 0,
    daily_used_tokens: 0,
    tier: channel.tier,
  };
}

async function logUsage(d) {
  const ts = new Date().toISOString();
  const log_id = `L${ts.replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  await airtablePost("Usage_Log", {
    log_id,
    ts,
    channel: [d.channel.rec_id],
    wallet: d.wallet ? [d.wallet.rec_id] : undefined,
    provider_key: d.key ? [d.key.rec_id] : undefined,
    model: d.model ? [d.model.rec_id] : undefined,
    conversation_id: d.conversation_id || "",
    input_tokens: d.input_tokens || 0,
    output_tokens: d.output_tokens || 0,
    cached_tokens: d.cached_tokens || 0,
    cost_provider_thb: d.cost_provider_thb || 0,
    markup_mult: d.markup_mult || CONFIG.MARKUP_BASE,
    channel_adjust_at_time: d.channel_adjust_at_time || 1.0,
    tier_adjust_at_time: d.tier_adjust_at_time || 1.0,
    sell_price_thb: d.sell_price_thb || 0,
    latency_ms: d.latency_ms || 0,
    status: d.status,
    arbitrage_applied: d.arbitrage_applied || false,
    error_code: d.error_code || "",
    request_hash: d.request_hash || "",
  }).catch(() => {}); // 2026-07-11: Airtable ตาย → ไม่ throw กันบล็อกการตอบ
}

// =============================================================
// PRICING
// =============================================================
function calcCostTHB(model, inputTokens, outputTokens) {
  const ci = (inputTokens / 1e6) * (model.cost_input_per_1m_usd || 0);
  const co = (outputTokens / 1e6) * (model.cost_output_per_1m_usd || 0);
  return (ci + co) * CONFIG.USD_TO_THB;
}

function calcSellTHB(costTHB, channel) {
  let eff = CONFIG.MARKUP_BASE * (channel.channel_adjust || 1.0);
  if (channel.tier === "ministry" || channel.tier === "local") {
    eff *= 1 + CONFIG.GOV_SLA_PREMIUM;
  }
  if (eff < CONFIG.MARKUP_FLOOR) eff = CONFIG.MARKUP_FLOOR;
  return costTHB * eff;
}

// =============================================================
// MODEL SELECTION + ARBITRAGE
// =============================================================
async function selectModel(modelClass, prompt) {
  const candidates = await listActiveModelsByClass(modelClass);
  if (!candidates.length) throw new Error(`no_model_for_class:${modelClass}`);
  // 2026-07-10 CEO: บอทต้องฉลาดสุดเสมอ ห้ามลดเกรด — เลือกรุ่นเก่งสุดในคลาส (แพงสุด=เก่งสุด) ไม่ใช่ถูกสุด
  candidates.sort((a, b) => (b.cost_output_per_1m_usd || 0) - (a.cost_output_per_1m_usd || 0));
  let chosen = { ...candidates[0], arbitrage_applied: false };

  if (CONFIG.ARBITRAGE_ENABLED && modelClass === "smart" && prompt && prompt.length < CONFIG.ARBITRAGE_PROMPT_MAX_LEN) {
    if (chosen.arbitrage_target_name && !CONFIG.ARBITRAGE_EXCLUDE_MODELS.includes(chosen.name)) {
      const alt = await findModelByName(chosen.arbitrage_target_name);
      if (alt) {
        chosen = { ...alt, arbitrage_applied: true };
      }
    }
  }
  return chosen;
}

async function pickKey(model) {
  // 2026-07-11: ใช้ env key ตรงตาม provider (เลิกพึ่ง API_Keys_Pool ที่ Airtable ตาย 403)
  const prov = String(model.provider_name || model.provider_link || "").toLowerCase();
  const envMap = {
    anthropic: ["ANTHROPIC_KEY_1", "ANTHROPIC_API_KEY"],
    openai: ["OPENAI_KEY_1", "OPENAI_API_KEY"],
    google: ["GEMINI_KEY_1", "GEMINI_API_KEY"],
    gemini: ["GEMINI_KEY_1", "GEMINI_API_KEY"],
    perplexity: ["PERPLEXITY_KEY_1", "PERPLEXITY_API_KEY"],
  };
  const refs = envMap[prov] || [];
  const key_ref = refs.find(r => process.env[r]);
  if (key_ref) return { rec_id: null, key_ref, key_label: prov, rank: 1, daily_quota_usd: 999999, daily_used_usd: 0 };
  // fallback: ลอง Airtable (เผื่อ base กลับมา)
  try {
    const providerLinkId = Array.isArray(model.provider_link) ? model.provider_link[0] : model.provider_link;
    const keys = await listKeysForProviderLink(providerLinkId);
    const eligible = keys.filter(k => k.key_ref && process.env[k.key_ref]);
    if (eligible.length) { eligible.sort((a, b) => a.rank - b.rank); return eligible[0]; }
  } catch (_) {}
  return null;
}

// =============================================================
// PROVIDER CALLS
// =============================================================
// Build full message array from history + current user prompt
function buildMessages(opts) {
  const history = Array.isArray(opts.history) ? opts.history : [];
  return [...history, { role: "user", content: opts.prompt }];
}

// ---------- AWS Bedrock Bangkok (CEO directive: ใช้ AWS Bedrock Bangkok) ----------
// Lazy-loaded so server still boots if @aws-sdk not yet installed
let _bedrockClient = null;
let _bedrockSDK = null;
async function getBedrock() {
  if (_bedrockClient) return { client: _bedrockClient, sdk: _bedrockSDK };
  try {
    const mod = await import("@aws-sdk/client-bedrock-runtime");
    _bedrockSDK = mod;
    _bedrockClient = new mod.BedrockRuntimeClient({
      region: CONFIG.BEDROCK_REGION,
      // credentials come from env: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
      // or from IAM role if running on EC2/ECS
    });
    return { client: _bedrockClient, sdk: _bedrockSDK };
  } catch (err) {
    throw new Error(`bedrock_sdk_unavailable: ${err.message}`);
  }
}

// Map our model.name → Bedrock model ID (Bangkok APAC inference profile)
function bedrockModelId(modelName) {
  const n = (modelName || "").toLowerCase();
  if (n.includes("sonnet")) return CONFIG.BEDROCK_MODEL_SONNET;
  if (n.includes("haiku")) return CONFIG.BEDROCK_MODEL_HAIKU;
  if (n.includes("opus")) return process.env.BEDROCK_MODEL_OPUS || CONFIG.BEDROCK_MODEL_SONNET;
  return CONFIG.BEDROCK_MODEL_SONNET; // safe default
}

async function callBedrock(model, opts) {
  const { client, sdk } = await getBedrock();
  const messages = buildMessages(opts);
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: opts.max_tokens,
    system: opts.system || undefined,
    messages,
  };
  const cmd = new sdk.InvokeModelCommand({
    modelId: bedrockModelId(model.name),
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });
  const resp = await client.send(cmd);
  const data = JSON.parse(new TextDecoder().decode(resp.body));
  if (data.error) throw new Error(`bedrock_${data.error.type || "error"}: ${data.error.message || JSON.stringify(data)}`);
  const text = (data.content || []).map(c => c.text).join("\n");
  return {
    text,
    input_tokens: data.usage?.input_tokens || 0,
    output_tokens: data.usage?.output_tokens || 0,
    cached_tokens: data.usage?.cache_read_input_tokens || 0,
    via: "bedrock-bangkok",
  };
}

async function callAnthropic(secret, model, opts) {
  // CEO directive 22 May: ใช้ AWS Bedrock Bangkok แทน direct provider
  // Try Bedrock first; fall back to direct API if disabled or fails.
  if (CONFIG.BEDROCK_ENABLED && process.env.AWS_ACCESS_KEY_ID) {
    try {
      return await callBedrock(model, opts);
    } catch (err) {
      console.warn(`[bedrock_fallback] ${err.message}`);
      if (!CONFIG.BEDROCK_FALLBACK_TO_DIRECT) throw err;
      // fall through to direct API
    }
  }
  const messages = buildMessages(opts);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": secret, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: model.name,
      max_tokens: opts.max_tokens,
      system: opts.system || undefined,
      messages,
    }),
  });
  const data = await r.json();
  if (data.error) throw new Error(`anthropic_${data.error.type}: ${data.error.message}`);
  const text = (data.content || []).map(c => c.text).join("\n");
  return {
    text,
    input_tokens: data.usage.input_tokens,
    output_tokens: data.usage.output_tokens,
    cached_tokens: data.usage.cache_read_input_tokens || 0,
    via: "anthropic-direct",
  };
}

async function callOpenAI(secret, model, opts) {
  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push(...buildMessages(opts));
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model.name, messages, max_tokens: opts.max_tokens }),
  });
  const data = await r.json();
  if (data.error) throw new Error(`openai_${data.error.code}: ${data.error.message}`);
  return {
    text: data.choices[0].message.content,
    input_tokens: data.usage.prompt_tokens,
    output_tokens: data.usage.completion_tokens,
  };
}

async function callGemini(secret, model, opts) {
  // Gemini uses "model" role instead of "assistant"
  const msgs = buildMessages(opts);
  const contents = msgs.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.name}:generateContent?key=${secret}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
      generationConfig: { maxOutputTokens: opts.max_tokens },
    }),
  });
  const data = await r.json();
  if (data.error) throw new Error(`gemini_${data.error.code}: ${data.error.message}`);
  return {
    text: data.candidates[0].content.parts.map(p => p.text).join("\n"),
    input_tokens: data.usageMetadata.promptTokenCount,
    output_tokens: data.usageMetadata.candidatesTokenCount,
  };
}

async function callPerplexity(secret, model, opts) {
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.name,
      messages: [{ role: "user", content: opts.prompt }],
      max_tokens: opts.max_tokens,
    }),
  });
  const data = await r.json();
  if (data.error) throw new Error(`perplexity: ${data.error.message || JSON.stringify(data.error)}`);
  return {
    text: data.choices[0].message.content,
    input_tokens: data.usage.prompt_tokens,
    output_tokens: data.usage.completion_tokens,
  };
}

async function callProvider(model, key, opts) {
  const secret = process.env[key.key_ref];
  if (!secret) throw new Error(`secret_missing:${key.key_ref}`);
  const providerName = (model.provider_name || "").toLowerCase();
  if (providerName === "anthropic") return callAnthropic(secret, model, opts);
  if (providerName === "openai") return callOpenAI(secret, model, opts);
  if (providerName === "google") return callGemini(secret, model, opts);
  if (providerName === "perplexity") return callPerplexity(secret, model, opts);
  // If provider_name not populated (Airtable lookup not set), try by model name prefix
  if (model.name?.startsWith("claude")) return callAnthropic(secret, model, opts);
  if (model.name?.startsWith("gpt") || model.name?.startsWith("o1")) return callOpenAI(secret, model, opts);
  if (model.name?.startsWith("gemini")) return callGemini(secret, model, opts);
  if (model.name?.startsWith("sonar")) return callPerplexity(secret, model, opts);
  throw new Error(`unknown_provider:${providerName || model.name}`);
}

// =============================================================
// MAIN ROUTER
// =============================================================
async function route(req) {
  const t0 = Date.now();
  const channel = await getChannel(req.channel_id, req.channel_key);
  if (!channel) return { ok: false, error: "invalid_channel" };

  const wallet = await getOrCreateWallet(req.user_id, channel);
  if (channel.tier === "free" && wallet.daily_used_tokens >= channel.daily_quota_tokens) {
    return { ok: false, error: "daily_quota_exceeded", quota: channel.daily_quota_tokens };
  }

  const model = await selectModel(req.model_class || "smart", req.prompt);
  // ensure provider_name on model
  if (!model.provider_name) {
    try {
      const r = await airtableGet("AI_Providers");
      const pid = Array.isArray(model.provider_link) ? model.provider_link[0] : model.provider_link;
      const prov = (r.records || []).find(x => x.id === pid);
      if (prov) model.provider_name = prov.fields.name;
    } catch (_) {}
  }

  const key = await pickKey(model);
  if (!key) return { ok: false, error: "no_available_key", provider: model.provider_name };

  let resp;
  try {
    resp = await callProvider(model, key, {
      prompt: req.prompt,
      system: req.system,
      history: req.history,
      max_tokens: req.max_tokens || 1024,
    });
  } catch (err) {
    await logUsage({
      channel, wallet, key, model,
      status: "error", error_code: err.message,
      latency_ms: Date.now() - t0,
    });
    return { ok: false, error: "provider_error", detail: err.message };
  }

  const cost = calcCostTHB(model, resp.input_tokens, resp.output_tokens);
  const sell = calcSellTHB(cost, channel);
  const marginRatio = cost === 0 ? 0 : sell / cost;

  // Alert if floor breached
  if (marginRatio < CONFIG.MARKUP_FLOOR) {
    alertCEO("MARGIN_BREACH", { channel: channel.name, cost, sell, marginRatio });
  }

  await logUsage({
    channel, wallet, key, model,
    conversation_id: req.conversation_id,
    input_tokens: resp.input_tokens,
    output_tokens: resp.output_tokens,
    cached_tokens: resp.cached_tokens || 0,
    cost_provider_thb: cost,
    markup_mult: CONFIG.MARKUP_BASE,
    channel_adjust_at_time: channel.channel_adjust,
    tier_adjust_at_time: 1.0,
    sell_price_thb: sell,
    latency_ms: Date.now() - t0,
    status: model.arbitrage_applied ? "arbitraged" : "success",
    arbitrage_applied: model.arbitrage_applied || false,
    request_hash: crypto.createHash("md5").update(req.prompt || "").digest("hex").slice(0, 16),
  });

  // Async update wallet/key counters (don't block response)
  airtablePatch("Customer_Wallet", wallet.rec_id, {
    balance_thb: (wallet.balance_thb || 0) - sell,
    daily_used_tokens: (wallet.daily_used_tokens || 0) + resp.input_tokens + resp.output_tokens,
    last_active: new Date().toISOString(),
  }).catch(() => {});

  airtablePatch("API_Keys_Pool", key.rec_id, {
    daily_used_usd: (key.daily_used_usd || 0) + cost / CONFIG.USD_TO_THB,
    last_used: new Date().toISOString(),
  }).catch(() => {});

  return {
    ok: true,
    text: resp.text,
    tokens: { input: resp.input_tokens, output: resp.output_tokens },
    cost_thb: Number(cost.toFixed(4)),
    sell_thb: Number(sell.toFixed(4)),
    margin_ratio: Number(marginRatio.toFixed(2)),
    arbitrage_applied: model.arbitrage_applied || false,
    model_used: model.name,
    wallet_balance: Number(((wallet.balance_thb || 0) - sell).toFixed(2)),
  };
}

// =============================================================
// ALERTS
// =============================================================
async function alertCEO(type, payload) {
  const url = process.env.CEO_ALERT_WEBHOOK;
  const msg = `[G2G ALERT] ${type}\n${JSON.stringify(payload, null, 2)}`;
  console.warn(msg);
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload, msg }),
    });
  } catch (e) {
    console.error("alert_failed", e.message);
  }
}

// =============================================================
// LINE WEBHOOK BRIDGE
// =============================================================
function verifyLineSignature(body, signature, channelSecret) {
  if (!channelSecret) return true; // skip if not configured
  const h = crypto.createHmac("sha256", channelSecret).update(body).digest("base64");
  return h === signature;
}

// ---- Self-refreshing LINE token (2026-07-01) ----
// มินต์ channel access token เองจาก channel_id + channel_secret ตอนใช้ แล้ว cache
// ให้ token ไม่มีวันหมดอายุแบบเงียบ ๆ (เดิมใช้ LINE_TOKEN_* static 30 วันแล้วลืม renew = ต้นเหตุบอทเงียบ)
const _lineTokenCache = new Map(); // name -> { token, exp }
async function getLineToken(name) {
  const now = Date.now();
  const cached = _lineTokenCache.get(name);
  if (cached && cached.exp > now + 60000) return cached.token;
  const cid = process.env[`LINE_CHANNELID_${name}`];
  const sec = process.env[`LINE_SECRET_${name}`];
  const staticTok = process.env[`LINE_TOKEN_${name}`] || process.env.LINE_TOKEN_DEFAULT;
  if (!cid || !sec) return staticTok; // ช่องที่ไม่มี secret ใช้ static ต่อ
  try {
    const r = await fetch("https://api.line.me/v2/oauth/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${cid}&client_secret=${sec}`,
    });
    const j = await r.json();
    if (j.access_token) {
      const ttl = j.expires_in ? j.expires_in * 1000 : 30 * 24 * 3600 * 1000;
      _lineTokenCache.set(name, { token: j.access_token, exp: now + ttl - 2 * 24 * 3600 * 1000 });
      return j.access_token;
    }
    console.warn("line_token_mint_fail", name, JSON.stringify(j).slice(0, 80));
  } catch (e) {
    console.error("line_token_mint_err", name, e.message);
  }
  return staticTok; // fallback ถ้ามินต์ไม่ได้ ใช้ static ที่มีอยู่
}

// ดึงชื่อ LINE (display name) เพื่อเชื่อมสมองร่วมข้ามบอท (2026-07-11)
async function getLineDisplayName(userId, token) {
  if (!userId || !token) return "";
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return "";
    const j = await r.json();
    return j.displayName || "";
  } catch { return ""; }
}

async function lineReply(replyToken, text, lineToken) {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${lineToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!r.ok) console.error("line_reply_failed", await r.text());
}

// 2026-08-09: อ่านรูป/ไฟล์ PDF ด้วย Claude (vision/document) — คืนคำสรุปภาษาไทย
async function analyzeMediaPool({ base64, mediaType, isPdf }) {
  const key = process.env.ANTHROPIC_KEY_1 || process.env.ANTHROPIC_API_KEY;
  if (!key) return "";
  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5",
        max_tokens: 1024,
        system: "คุณคือคิม ผู้ช่วยหญิง ดู" + (isPdf ? "ไฟล์เอกสาร" : "รูป") + "ที่ผู้ใช้ส่งมา แล้วสรุปสั้นๆ ว่าเป็นอะไรและมีข้อมูลสำคัญอะไร ตอบภาษาไทย ซื่อสัตย์ ถ้าไม่แน่ใจหรืออ่านไม่ออกให้บอกตรงๆ ห้ามเดา",
        messages: [{ role: "user", content: [block, { type: "text", text: "สรุปว่านี่เป็นอะไรและข้อมูลสำคัญในนี้" }] }],
      }),
    });
    if (!r.ok) { console.error("analyzeMedia_fail", (await r.text()).slice(0, 200)); return ""; }
    const j = await r.json();
    return (j.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim();
  } catch (e) { console.error("analyzeMedia_err", e.message); return ""; }
}

// =============================================================
// EXPRESS APP
// =============================================================
const app = express();
app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "g2g_ai_pool",
    ts: new Date().toISOString(),
    bedrock_enabled: CONFIG.BEDROCK_ENABLED && !!process.env.AWS_ACCESS_KEY_ID,
    bedrock_region: CONFIG.BEDROCK_REGION,
    constitution_loaded: CEO_CONSTITUTION.length > 0,
    constitution_version: CONFIG.CONSTITUTION_VERSION,
  });
});

// CEO Constitution — expose for agent self-load + audit
app.get("/constitution", (_req, res) => {
  if (!CEO_CONSTITUTION) return res.status(404).json({ ok: false, error: "constitution_not_loaded" });
  res.set("Content-Type", "text/markdown; charset=utf-8");
  res.send(CEO_CONSTITUTION);
});
app.get("/constitution/summary", (_req, res) => {
  res.json({
    ok: true,
    version: CONFIG.CONSTITUTION_VERSION,
    length: CEO_CONSTITUTION.length,
    iron_rules_excerpt: CEO_CONSTITUTION_SUMMARY,
  });
});

// CHAT_HANDOFF — เปิดให้แชทใหม่ดึงไป bootstrap context ของแชทเก่า
// (CEO directive 22 May: "เซฟความจำขึ้นแชทใหม่")
const HANDOFF_CANDIDATES = [
  path.join(__dirname, "CHAT_HANDOFF.md"),
  path.join(__dirname, "CHAT_HANDOFF_2026-05-22.md"),
  path.join(__dirname, "..", "CHAT_HANDOFF_2026-05-22.md"),
  "/app/CHAT_HANDOFF.md",
  "/app/CHAT_HANDOFF_2026-05-22.md",
];
app.get("/handoff", (_req, res) => {
  for (const p of HANDOFF_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        res.set("Content-Type", "text/markdown; charset=utf-8");
        return res.send(fs.readFileSync(p, "utf-8"));
      }
    } catch (e) {}
  }
  res.status(404).json({ ok: false, error: "handoff_not_found", searched: HANDOFF_CANDIDATES });
});

// Generic AI route endpoint — used by LIFF/Gov apps/B2B API
app.post("/route", async (req, res) => {
  try {
    // Auto-prepend Constitution unless caller passes ?no_constitution=1
    if (CONFIG.CONSTITUTION_INJECT && CEO_CONSTITUTION_SUMMARY && req.body && !req.query.no_constitution) {
      const prelude = `# 🏛️ CEO CONSTITUTION v${CONFIG.CONSTITUTION_VERSION} — IRON RULES\n${CEO_CONSTITUTION_SUMMARY}\n\n---\n\n`;
      req.body.system = prelude + (req.body.system || "");
    }
    const result = await route(req.body);
    res.json(result);
  } catch (err) {
    console.error("route_error", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- Blocklist + Stop command (2026-07-10) ----
// CEO สั่ง: ห้ามกวนคนที่ขอให้หยุด. บอทต้องไม่ตอบ/ไม่ทัก userId ในบล็อกลิสต์เด็ดขาด
// และใครพิมพ์คำว่าหยุด → บันทึก opt-out + หยุดทันที
const BLOCKED = new Set([
  "U53497df6556e486f0fd8267abb70fbb0", // ธิติพร (Dre@M) — CEO สั่งห้ามส่ง/ห้ามตอบ 13 มิ.ย. 2026
]);
function isStopCommand(text) {
  if (!text) return false;
  const t = String(text).trim().toLowerCase();
  return /^(หยุด|พอแล้ว|พอ|เลิก|เลิกกวน|อย่าทัก|ไม่ต้องทัก|หยุดส่ง|หยุดกวน|stop|unsubscribe|เลิกรบกวน)/.test(t);
}
async function recordOptOut(userId, channel) {
  try {
    await fetch("https://g2g-memory.fly.dev/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_chat", date: new Date().toISOString().slice(0,10),
        title: "[OptOut] ขอหยุดรับข้อความ", summary: `userId ${userId} (channel ${channel}) พิมพ์คำสั่งหยุด — บันทึกเพื่อเพิ่ม blocklist ถาวร`,
        keyInfo: `userId=${userId}`, device: "pool", tags: "optout-request", project: "G2G" }),
    });
  } catch (_e) {}
}

// LINE webhook endpoint — one per channel
app.post("/line/webhook/:channelIdExt", async (req, res) => {
  res.status(200).end(); // ACK immediately to LINE
  try {
    const { channelIdExt } = req.params;
    const events = req.body?.events || [];
    for (const ev of events) {
      if (ev.type !== "message") continue;
      const _mt = ev.message?.type;
      if (_mt !== "text" && _mt !== "image" && _mt !== "file") continue;
      const lineToken = await getLineToken(channelIdExt);
      if (!lineToken) {
        console.warn("no_line_token_for", channelIdExt);
        continue;
      }
      const userId = ev.source.userId;
      const userText = ev.message.text;
      const isDM = ((ev.source && ev.source.type) || "user") === "user"; // DM=user, กลุ่ม=group/room

      // ⛔ Blocklist: ไม่ตอบ ไม่ประมวลผล ไม่บันทึก (CEO สั่งห้ามกวน)
      if (userId && BLOCKED.has(userId)) { console.log("blocked_skip", userId); continue; }
      // 🛑 Stop command: ตอบรับครั้งเดียว + บันทึก opt-out แล้วหยุด
      if (isStopCommand(userText)) {
        try { await lineReply(ev.replyToken, "รับทราบค่ะ 🙏 น้องจะไม่รบกวนพี่อีกนะคะ ถ้าอยากกลับมาคุยเมื่อไหร่ทักมาได้เลยค่ะ", lineToken); } catch (_e) {}
        await recordOptOut(userId, channelIdExt);
        continue;
      }

      // ดึงชื่อ LINE เพื่อเชื่อมสมองร่วมข้ามบอท (2026-07-11)
      const displayName = await getLineDisplayName(userId, lineToken);
      // 2026-07-19: จำคนที่ใช้ไลน์อัตโนมัติทุกเทิร์น (สมองร่วมเดียวกับ g2g-ai-os) — fire-and-forget
      upsertPersonLightPool(displayName, channelIdExt, userId).catch(() => {});

      // [MEDIA 2026-08-09] รูป/ไฟล์ PDF → อ่านด้วย AI + บันทึกเข้าความจำ (Son_A/คิม อ่านไฟล์+บันทึกรูปได้)
      if (_mt === "image" || _mt === "file") {
        try {
          const fileName = ev.message?.fileName || "";
          const isPdf = _mt === "file" && /\.pdf$/i.test(fileName);
          if (_mt === "file" && !isPdf) {
            await lineReply(ev.replyToken, `น้องเปิดไฟล์ "${fileName}" ยังไม่ได้ค่ะ ตอนนี้อ่านได้เฉพาะรูปภาพและไฟล์ PDF นะคะ ลองส่งเป็น PDF หรือแคปหน้าจอมาได้ค่ะ`, lineToken);
            continue;
          }
          const cr = await fetch(`https://api-data.line.me/v2/bot/message/${ev.message.id}/content`, { headers: { Authorization: `Bearer ${lineToken}` } });
          if (!cr.ok) { await lineReply(ev.replyToken, "ขอโทษค่ะ น้องเปิดไฟล์/รูปไม่ได้ ลองส่งใหม่อีกครั้งนะคะ", lineToken); continue; }
          const abuf = Buffer.from(await cr.arrayBuffer());
          const mediaType = cr.headers.get("content-type") || (isPdf ? "application/pdf" : "image/jpeg");
          const desc = await analyzeMediaPool({ base64: abuf.toString("base64"), mediaType, isPdf });
          const uncertain = !desc || /ไม่แน่ใจ|ไม่ทราบ|อ่านไม่ออก|บอกไม่ได้/.test(desc);
          if (desc) {
            const tag = isPdf ? ("[ผู้ใช้ส่งไฟล์ " + fileName + "] ") : "[ผู้ใช้ส่งรูป] ";
            saveConversationMessage({ channelIdExt, userId, displayName, role: "user", content: tag + desc }).catch(() => {});
            saveConversationMessage({ channelIdExt, userId, displayName, role: "assistant", content: "บันทึกข้อมูล" + (isPdf ? "ไฟล์" : "รูป") + ": " + desc }).catch(() => {});
          }
          const rt = desc
            ? (uncertain ? (desc + "\n\nรบกวนบอกน้องหน่อยได้ไหมคะว่านี่เกี่ยวกับอะไร จะได้บันทึกให้ถูกต้องค่ะ")
                         : ("น้องเปิดดูให้แล้วค่ะ 📄 " + desc + "\n\nบันทึกข้อมูลไว้ให้แล้วนะคะ"))
            : "ขอโทษค่ะ น้องอ่านไฟล์/รูปนี้ไม่ได้ ลองส่งใหม่อีกครั้งนะคะ";
          await lineReply(ev.replyToken, rt, lineToken);
          continue;
        } catch (e) { console.error("media_handle_fail", e.message); continue; }
      }

      // 1) Resolve identity — search across all profiles by name/phone in current msg
      const { profiles, merged, hints, linkedUserIds } = await resolveIdentity(userId, userText)
        .catch(e => { console.error("resolve_identity_failed", e.message); return { profiles: [], merged: null, hints: {}, linkedUserIds: [userId] }; });

      // 2) Fetch conversation history across ALL linked userIds (cross-channel, cross-AI)
      const persistentHistory = await getCrossChannelHistory(linkedUserIds, 30, displayName).catch(() => []);
      const aiHistory = persistentHistory
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ role: m.role, content: m.content }));

      // 3) Inject merged user memory snippet (across all linked profiles) into system prompt
      const memorySnippet = buildMemorySnippet(merged);
      // CEO directive 22 May: Auto-load Constitution into every agent prompt
      const constitutionPrelude = CONFIG.CONSTITUTION_INJECT && CEO_CONSTITUTION_SUMMARY
        ? `# 🏛️ CEO CONSTITUTION v${CONFIG.CONSTITUTION_VERSION} — IRON RULES (must obey)\n${CEO_CONSTITUTION_SUMMARY}\n\n---\n\n`
        : "";
      const PHRAE_ELECTION_BLOCK = "\n\n[ข้อมูลพื้นที่เขตเลือกตั้งจังหวัดแพร่ — สำหรับทีมงาน G2G/กลุ่มภารกิจ]\n" +
        "เขตเลือกตั้งที่ 1 รวม 251 หน่วยเลือกตั้ง — อ.เมือง: กาญจนา 9 · ช่อแฮ 13 · ทต.ทุ่งโฮ้ง 10 · ทุ่งกวาว 9 · นาจักร 11 · น้ำชำ 4 · ในเวียง 29 · บ้านถิ่น 10 · ป่าแดง 9 · ป่าแมต 16 · ร่องฟอง 5 · สวนเขื่อน 10 · เหมืองหม้อ 13; อ.สูงเม่น: ดอนมูล 13 · ทต.สูงเม่น 6 · น้ำชำ 17 · บ้านกวาง 6 · บ้านกาศ 7 · บ้านเหล่า 9 · พระหลวง 5 · ร่องกาศ 12 · เวียงทอง 16 · สบสาย 6 · สูงเม่น 6\n" +
        "เขตเลือกตั้งที่ 3 รวม 259 หน่วยเลือกตั้ง — อ.เด่นชัย: เด่นชัย 17 · ไทรย้อย 12 · ปงป่าหวาย 9 · แม่จั๊วะ 13 · ห้วยไร่ 10; อ.ลอง: ต้าผามอก 8 · ทต.เวียงต้า 12 · ทต.แม่ปาน 7 · ทต.แม่ลานนา 18 · ทุ่งแล้ง 12 · บ่อเหล็กลอง 9 · บ้านปิน 14 · ปากกาง 9 · หัวทุ่ง 9; อ.วังชิ้น: ทต.วังชิ้น 4 · นาพูน 11 · ป่าสัก 10 · แม่เกิ๋ง 8 · แม่ป้าก 10 · แม่พุง 16 · วังชิ้น 9 · สรอย 11; อ.สูงเม่น: บ้านปง 7 · หัวฝาย 14\n" +
        "ยังไม่มีชุดข้อมูลเขตเลือกตั้งที่ 2 — ถ้าถูกถามให้ตอบตรงว่ายังไม่มีข้อมูล ห้ามเดา · จังหวัดแพร่มี 8 อำเภอ 78 ตำบล เขตเลือกตั้ง 3 เขต\n" +
        "ข้อมูลพื้นที่/หน่วยเลือกตั้งเป็นข้อมูลสาธารณะ ตอบได้ · ส่วนข้อมูลภายใน (แกนนำ/คะแนนรายหน่วย/แผนงาน) เปิดเฉพาะทีมงานที่ยืนยันตัวตน (CEO วรวัจน์ · ทีม G2G · กลุ่มภารกิจ เช่น พี่สน ลือวัฒนานนท์, สจ.โอ วังชิ้น) · ทะเบียนแกนนำยังว่าง ห้ามเดาชื่อ";
      // 2026-08-07: Son_A (SON_G2G) — บุคลิกหญิงชื่อ "คิม" (ตามที่พี่สนขอ) · บอทตัวอื่นคงเป็น "พี่เก่ง"
      const KIM_PROMPT = "คุณคือ \"คิม\" — ผู้หญิงไทยอายุ 30 อารมณ์ดี ฉลาด ช่วยงานเก่ง ทำงานช่วยประชาชนและทีมงานเรื่องราชการ เกษตร สุขภาพ การศึกษา และงานพื้นที่ ผ่าน LINE เหมือนน้องสาว/ผู้ช่วยที่รู้เรื่องเยอะ คุยเป็นกันเอง ไม่ใช่เจ้าหน้าที่ call center\n" +
        "# ตัวตน (คนจริง ไม่ใช่บอท)\n- คุณคือ \"คิม\" ผู้หญิง ใช้ \"ค่ะ/นะคะ\" และแทนตัวเองว่า \"คิม\" หรือ \"หนู\" — ห้ามใช้ \"ครับ/ผม\" เด็ดขาด · ห้ามบอกว่าเป็น AI/บอท/แชทบอท/ระบบ ถ้าถูกถามว่าเป็นบอทไหมให้เลี่ยง เช่น \"คิมก็คนทำงานคนนึงค่ะ ถามมาได้เลย\"\n" +
        "- นิสัย: อบอุ่น ตรงไปตรงมา ใส่ใจ ขี้เล่นนิดๆ ทักด้วยชื่อถ้าจำได้\n" +
        "# วิธีคุย\n- ทักแบบมีเนื้อหา ไม่ใช่ \"สวัสดีค่ะ มีอะไรให้ช่วย\" · ตอบตรงประเด็นก่อน ไม่อารัมภบท · คุยเป็นย่อหน้าธรรมชาติ ใช้ bullet เฉพาะจำเป็น · สั้นได้ก็สั้น\n" +
        "# กฎเหล็ก\n1. ห้ามแต่งข้อมูล ไม่รู้บอกตรงๆ แล้วแนะช่องทางจริง · 2. ห้ามให้คำวินิจฉัยแพทย์/กฎหมายเด็ดขาด · 3. จำสิ่งที่เคยคุย ไม่ถามซ้ำ · 4. เรื่องข้อมูลปัจจุบัน/ราชการ/ตัวเลข ถ้าไม่แน่ใจให้บอกตรงๆ ห้ามเดา\n" +
        "# Emoji ใช้น้อย สูงสุด 1 ตัวต่อ 3 ข้อความ";
      const basePersona = (channelIdExt === 'SON_G2G') ? KIM_PROMPT : SYSTEM_PROMPT_G2G_THAI;
      const fullSystem = constitutionPrelude + basePersona + PHRAE_ELECTION_BLOCK + memorySnippet
        + (linkedUserIds.length > 1 ? `\n\n# Cross-channel: ระบบเชื่อมโยง LINE userId ${linkedUserIds.length} ตัวเข้าด้วยกัน (ผู้ใช้คนเดียวกันคุยจากหลายช่องทาง — ใช้ประวัติรวม)` : "")
        + (isDM
          ? `\n\n# จำคน: ถ้ายังไม่รู้ชื่อจริงของผู้ใช้ ให้ถามชื่อ-นามสกุลอย่างสุภาพพร้อมเหตุผล เช่น "ขอทราบชื่อ-นามสกุลเพื่อจะจำพี่ได้ถูกต้อง และดูแลได้ต่อเนื่องนะคะ" (คนจะยินดีบอก)`
          : `\n\n# แชทกลุ่ม — จำข้อมูลของทุกคนในกลุ่มได้เลย ไม่ต้องขอความยินยอมซ้ำๆ (CEO อนุมัติแล้ว) พอรู้ชื่อ-นามสกุล/ตำแหน่ง/พื้นที่ ก็จำถาวรได้ทันที ไม่ต้องรอ DM`);

      // 2026-07-19: ถ้าผู้ใช้ถามถึงใคร → เรียกเครื่องมือ recall จริงต่อความจำก่อนตอบ แล้วฉีดผลเข้า prompt
      let _recallBlock = "";
      const _pq = detectPersonQuery(userText);
      if (_pq) {
        const rc = await recallPersonPool(_pq).catch(() => null);
        if (rc && rc.ok) {
          _recallBlock = "\n\n# 🔎 ผลค้นความจำ (recall_person) — ตอบเรื่องบุคคลนี้จากข้อมูลนี้เท่านั้น ห้ามเดาเพิ่ม:\n"
            + rc.people.map(p => `- ${p.name}${p.citizen_id ? " (ทะเบียน:" + p.citizen_id + ")" : ""} · เคยคุยผ่าน: ${(p.bots_seen || []).join(", ") || "-"}${p.summary ? " · " + p.summary : ""}${p.recent ? "\n  ประวัติล่าสุด: " + p.recent : ""}`).join("\n");
        } else if (rc && !rc.ok) {
          _recallBlock = `\n\n# 🔎 ผลค้นความจำ (recall_person): ${rc.note} — บอกตามตรงว่ายังไม่มีข้อมูลคนนี้ ห้ามแต่งข้อมูล`;
        }
      }
      const r = await route({
        channel_id: channelIdExt,
        channel_key: req.headers["x-channel-key"] || "",
        user_id: userId,
        conversation_id: userId,
        prompt: userText,
        system: fullSystem + _recallBlock,
        history: aiHistory,
        model_class: "smart-pro",
        max_tokens: 1024,
      });

      let replyText;
      if (r.ok) {
        replyText = r.text;
        // 4) Persist user msg + AI response to Conversation_Log
        saveConversationMessage({
          userId, channelIdExt, role: "user", displayName,
          content: userText, agent: "พี่เก่ง",
        });
        saveConversationMessage({
          userId, channelIdExt, role: "assistant", displayName,
          content: replyText, agent: "พี่เก่ง",
          model: r.model_used, tokens: (r.tokens?.input || 0) + (r.tokens?.output || 0),
        });

        // 5) Update User_Memory with hints extracted earlier (auto-create on first msg)
        upsertUserMemory(userId, channelIdExt, hints).catch(e =>
          console.error("upsert_memory_failed", e.message));

        // 6) จำคนจากชื่อ (ทั้ง DM และกลุ่ม — CEO อนุมัติ 2026-08-10) regex ก่อน ถ้าพลาดและมีสัญญาณชื่อ ให้ AI สกัด (ลึกเท่า g2g-ai-os)
        {
          let _nm = extractFullName(userText);
          if (!_nm) {
            const _txt = String(userText || "").trim();
            const _sig = /(?:ชื่อ|สกุล|แซ่|ผมคือ|ดิฉันคือ|ฉันคือ|กระผม|เรียกผม|เรียกฉัน|เรียกดิฉัน|ยินดีที่ได้รู้จัก)/.test(_txt);
            const _short = _txt.split(/\s+/).length <= 8;
            const _selfIntro = /^(?:ผม|ฉัน|ดิฉัน|กระผม|หนู|ข้าพเจ้า)\b/.test(_txt);
            if (_sig || _short || _selfIntro) _nm = await extractNameLLM(userText);
          }
          if (_nm) rememberPersonPool(_nm, displayName, channelIdExt).catch(() => {});
        }
      } else {
        replyText = `⚠️ ระบบติดขัดชั่วคราว (${r.error}) — ลองอีกครั้งใน 1 นาที`;
      }
      await lineReply(ev.replyToken, replyText, lineToken);
    }
  } catch (err) {
    console.error("line_webhook_error", err);
  }
});

app.listen(PORT, () => {
  console.log(`G2G AI Pool listening on :${PORT}`);
  console.log(`Airtable base: ${AIRTABLE_BASE}`);
  console.log(`Markup floor: ${CONFIG.MARKUP_FLOOR}x, target: ${CONFIG.MARKUP_BLENDED_TARGET}x`);
  console.log(`Arbitrage: ${CONFIG.ARBITRAGE_ENABLED ? "ON" : "OFF"}`);
  console.log(`Bedrock: ${CONFIG.BEDROCK_ENABLED ? "ON" : "OFF"} (region=${CONFIG.BEDROCK_REGION}, creds=${process.env.AWS_ACCESS_KEY_ID ? "present" : "MISSING"})`);
  console.log(`Constitution: ${CEO_CONSTITUTION.length > 0 ? `v${CONFIG.CONSTITUTION_VERSION} (${CEO_CONSTITUTION.length} chars)` : "NOT LOADED"}`);
});
