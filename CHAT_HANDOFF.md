# 🔁 CHAT HANDOFF — 22 พ.ค. 2026 → แชทถัดไป

> **Reason for handoff:** CEO สั่ง "เซฟความจำ ขึ้นแชทใหม่" และ chat-memory POST `save_chat` ติด 500 error (Apps Script bug)
> **Fallback method:** เก็บไฟล์นี้ในเครื่อง → แชทใหม่ต้องเริ่มด้วยการ Read ไฟล์นี้ก่อน
> **Audience:** Claude agent ที่จะรับช่วงงานต่อ

---

## 🏛️ STEP 0 — โหลด Constitution ก่อนเสมอ

```
Read: outputs/00_CEO_CONSTITUTION.md
```

อ่านจบแล้วถึงค่อยตอบ CEO เรื่องอะไรก็ตาม — เป็นคำสั่งสูงสุด

---

## 👤 IDENTITY (ตรึงไว้)

- **CEO ชื่อ:** วรวัจน์ เอื้ออภิญญกุล (IRON RULE — ห้ามเขียนผิด)
- **CEO_uid anchor:** `338358fd-ab2a-46b2-9b4d-65c3098f4d9d`
- **Email:** g2g@gov2global.com

---

## 📍 จุดที่งานหยุดอยู่ ณ ปลายแชทนี้

### ✅ เสร็จแล้ว (ในแชทนี้)
1. AI Pool architecture + Fly.io deploy — `g2g-ai-pool.fly.dev`
2. Airtable base `app6keeRcHmiTMLKy` — 10 tables พร้อม seed data
3. Pricing: 3x floor / 3.5x default / 4x target / 5–6x gov / 8x+ niche
4. "พี่เก่ง" persona system prompt — anti-bot rules
5. Persistent Memory: `User_Memory` + `Conversation_Log` + `resolveIdentity()` + cross-channel history
6. **CEO CONSTITUTION v2.0** — 354 บรรทัด รวม 200+ records จาก chat-memory → `outputs/00_CEO_CONSTITUTION.md`
7. **AWS Bedrock Bangkok migration (code)** — `server.js` callAnthropic() → callBedrock() default, fallback direct
8. **Auto-load Constitution** — server boot โหลด, inject IRON RULES ทุก request, expose `/constitution` endpoint

### ⏳ ค้างอยู่ — ต้องทำต่อในแชทใหม่

| # | Item | Blocker |
|---|---|---|
| A | Deploy Bedrock migration → Fly | รอ CEO ใส่ `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + เปิด Bedrock model access (Bangkok region) — checklist อยู่ที่ `outputs/11_AWS_BEDROCK_BANGKOK_DEPLOY.md` |
| B | End-to-end test ส่งข้อความ LINE จริง | รอ CEO กดส่ง |
| C | Fix chat-memory Apps Script POST 500 | Apps Script Code.gs runtime error — ต้องเปิด Apps Script Editor → debug `doPost()` handler |
| D | 12 rules UR-2026-05-07-CEO-RULES baseline pull เพิ่มเข้า Constitution | ต้อง pull จาก chat-memory record อีกรอบ |
| E | AI Pool vs AI Premium merge/split decision | รอ CEO ตัดสิน — Constitution หมวด "CRITICAL DECISION pending CEO" |

---

## 🔑 SECRETS STATE (อย่าพิมพ์ — ใช้ pbpaste pipe เท่านั้น)

- Fly secrets already set: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `AIRTABLE_PAT`, `LINE_TOKEN_*`, `LINE_CHANNEL_SECRET_*`
- **Missing:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (CEO ต้องใส่)

---

## 🛠️ TECH STACK CURRENT STATE

```
LINE OA (G2G ประชาชน C001)
    ↓ webhook
Fly.io Singapore — g2g-ai-pool.fly.dev (Node.js Express)
    ├─ Airtable app6keeRcHmiTMLKy (Channels, AI_Models, API_Keys_Pool, Usage_Ledger, Customer_Wallet, User_Memory, Conversation_Log...)
    ├─ Constitution loaded at boot → /app/00_CEO_CONSTITUTION.md
    ├─ Bedrock client → ap-southeast-7 (Bangkok)  ← NEW, รอ AWS creds
    └─ Anthropic direct API fallback
```

### URLs สำคัญ
- App: `https://g2g-ai-pool.fly.dev`
- Health: `https://g2g-ai-pool.fly.dev/health`
- Constitution: `https://g2g-ai-pool.fly.dev/constitution`
- LINE webhook (C001): `https://g2g-ai-pool.fly.dev/line/webhook/C001`

---

## 🎯 NEXT 3 ACTIONS (เรียงตามความเร่งด่วน)

1. **CEO ใส่ AWS creds + เปิด Bedrock access** → `fly deploy` → verify `/health` เห็น `bedrock_enabled:true` (ขั้นตอนละเอียดใน `outputs/11_AWS_BEDROCK_BANGKOK_DEPLOY.md`)
2. **CEO ส่งข้อความ LINE จริง** ไปที่ G2G ประชาชน OA → ตรวจว่าตอบเป็น "พี่เก่ง" + จำชื่อเมื่อบอก
3. **Fix chat-memory 500** — แล้ว push Constitution + handoff ขึ้น chat-memory (ตอนนี้เก็บไฟล์ในเครื่องเป็น fallback)

---

## 📜 IRON RULES สรุปย่อ (ห้ามลืม)

1. ห้ามเขียนชื่อ CEO ผิด — "วรวัจน์ เอื้ออภิญญกุล" เท่านั้น
2. ห้าม fabricate fact / data / ตัวเลข
3. ห้ามพิมพ์ API key แทน CEO (ใช้ pbpaste)
4. AI ต้องคุยให้เหมือนคน ไม่ใช่บอท
5. Margin Floor 3.0x — ต่ำกว่านี้ alert
6. โหลด Constitution + chat-memory ก่อนทุก decision
7. "ทำทันที" / "เดี๋ยวนี้เลย" = execute ไม่ใช่ ask permission
8. NO-MAKEUP — ไม่รู้บอกตรงๆ

---

**End of handoff — load Constitution ต่อ แล้วถาม CEO ว่าจะให้ทำอะไรต่อ**
