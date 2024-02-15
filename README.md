# QuRe: Sovereign Health Identity 🧬

QuRe is a decentralized, patient-centric health data platform. It empowers patients with absolute sovereignty over their medical records while providing healthcare professionals with secure, frictionless access via dynamic QR handshakes. Powered by Google's Gemini AI, QuRe also features an intelligent health concierge to help patients understand their medical history.

![QuRe Interface Concept](https://picsum.photos/seed/qure/1200/400?blur=2)

## 🌟 Core Vision

Traditional healthcare systems silo patient data across multiple providers. QuRe flips this model: **The patient is the center of the network.** 
Records are encrypted and stored directly in the patient's personal Google Drive vault. Hospitals and clinics (Clinical Nodes) must request access via a physical QR scan, ensuring data is only shared with explicit, present consent.

## ✨ Key Features

### 👤 Patient Portal (The Vault)
*   **Sovereign Storage:** Medical records are standardized to PDF and encrypted directly into the user's personal Google Drive (`QURE records` folder).
*   **Dynamic Identity Key:** A secure, auto-refreshing (every 30s) QR code acts as the patient's universal health identifier.
*   **AI Health Concierge:** Powered by **Gemini 3.1 Pro**, the concierge analyzes the patient's medical ledger to answer health queries, summarize records, and provide clinical context (safeguarded with strict medical disclaimers).
*   **Real-time Ledger:** View all medical records, prescriptions, and imaging reports in one unified dashboard.

### 🏥 Clinical Node (Provider Dashboard)
*   **Secure Access:** Verified medical personnel can log in to the Clinical Node.
*   **QR Handshake:** Providers use their device camera to scan a patient's Identity Key, establishing a secure, temporary session.
*   **Direct-to-Vault Uploads:** Providers can upload new lab results, clinical notes, or prescriptions directly to the patient's sovereign vault.
*   **Session Management:** Strict session timeouts and manual end-session controls ensure data privacy after the consultation ends.

### 🛡️ Admin Node (Registry & Audit)
*   **Hospital Registry:** Administrators manage the allowlist of verified medical facilities.
*   **Audit Logs:** Immutable access logs track every time a patient's record is accessed or modified.
*   **User Management:** Oversee patient and provider accounts, verify new clinical nodes, and maintain network integrity.

## 🛠️ Architecture & Tech Stack

*   **Frontend:** React 19, TypeScript, Vite
*   **Styling:** Tailwind CSS 4 (Glassmorphism, HD Gradients, Custom Animations)
*   **Authentication:** Supabase Auth (Google OAuth for Patients, Email/Password for Providers)
*   **Database & Realtime:** Supabase PostgreSQL (Ledger metadata, Audit logs, Real-time sync)
*   **Storage:** Google Drive API (Primary Vault for PDFs), Supabase Storage (Temporary transit)
*   **AI Engine:** `@google/genai` (Gemini 3.1 Pro Preview with Google Search Grounding)
*   **Utilities:** `jsQR` (QR Scanning), `qrcode` (QR Generation), `jsPDF` (Client-side PDF standardization)

## 🔐 Security & Privacy Model

1.  **Zero-Knowledge Architecture (Partial):** The platform stores *metadata* (titles, categories, timestamps) in Supabase, but the *actual files* reside in the patient's Google Drive.
2.  **Ephemeral Access:** Provider access to a patient's vault is strictly session-based, initiated by a physical QR scan.
3.  **Environment Isolation:** All sensitive API keys are injected at build/runtime via environment variables.

---

## 🚀 Local Development Setup

### Prerequisites
*   Node.js (v18+ recommended)
*   npm or yarn
*   Supabase Project (URL & Anon Key)
*   Google Gemini API Key
*   Google Cloud Console Project (configured for Drive API & OAuth)

### 1. Clone & Install
```bash
git clone <repository-url>
cd qure-sovereign-health
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory (use `.env.example` as a template):

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
GEMINI_API_KEY=your-gemini-api-key
```

### 3. Start Development Server
```bash
npm run dev
```
The application will be available at `http://localhost:3000`.

---

## 🌍 Deployment Guide (Netlify)

This project is pre-configured for seamless deployment to Netlify.

1.  **Connect Repository:** Link your GitHub/GitLab repository to Netlify.
2.  **Build Settings:**
    *   **Framework Preset:** Vite
    *   **Build Command:** `npm run build`
    *   **Publish Directory:** `dist`
3.  **Environment Variables:** In the Netlify dashboard (Site Settings > Environment Variables), add:
    *   `VITE_SUPABASE_URL`
    *   `VITE_SUPABASE_ANON_KEY`
    *   `GEMINI_API_KEY`
4.  **Routing:** The project includes a `public/_redirects` file (`/* /index.html 200`) to ensure React Router handles SPA navigation correctly without 404 errors.

---

## 📁 Project Structure

```text
├── public/
│   └── _redirects              # Netlify SPA routing configuration
├── src/
│   ├── components/             # React Components
│   │   ├── AdminDashboard.tsx  # Registry & Audit interface
│   │   ├── HospitalDashboard.tsx # Provider QR scanner & upload interface
│   │   ├── PatientDashboard.tsx  # Sovereign vault & AI Concierge
│   │   ├── LandingAnimation.tsx  # Intro sequence
│   │   ├── QRIdentity.tsx      # Dynamic QR generator
│   │   └── RecordCard.tsx      # Medical record UI component
│   ├── services/               # External Integrations
│   │   ├── driveService.ts     # Google Drive API logic
│   │   ├── geminiService.ts    # Gemini 3.1 Pro integration
│   │   ├── pdfUtils.ts         # jsPDF standardization logic
│   │   └── supabase.ts         # Supabase client initialization
│   ├── App.tsx                 # Main application router & auth state
│   ├── index.css               # Tailwind & Custom CSS (Glassmorphism)
│   ├── main.tsx                # React entry point
│   └── types.ts                # TypeScript interfaces & enums
├── .env.example                # Environment variable template
├── package.json                # Dependencies & Scripts
└── vite.config.ts              # Vite bundler configuration
```

---

## ⚠️ Medical Disclaimer

**QuRe is a technology demonstration.** The AI Concierge is designed for informational purposes only and does not constitute professional medical advice, diagnosis, or treatment. Always seek the advice of your physician or other qualified health provider with any questions you may have regarding a medical condition. Never disregard professional medical advice or delay in seeking it because of something you have read on this application.

---
*Built with React, Supabase, and Google Gemini.*
