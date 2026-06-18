# PRD: Hampta Pass Trip Tracker (v3)

## 1. Product Overview
A high-performance, real-time expense and status tracking dashboard designed for a 4-person trekking group. The application eliminates the "who owes who" friction and provides real-time connectivity in low-bandwidth environments via a Supabase-backed live sync.

## 2. Target Audience
* **Users:** 4 Trekkers + 1 Treasurer.
* **Context:** High-altitude trekking (Hampta Pass), necessitating offline-first data integrity and ultra-light UI.

## 3. Core Features
| Feature | Functionality |
| :--- | :--- |
| **Live Sync** | Real-time database synchronization via Supabase `Realtime` channels. |
| **Burn Rate Tracker** | GSAP-animated "Traffic Light" header indicating spend velocity vs. 60k budget. |
| **Treasurer Tools** | Elevated access for 5th user to log `FIXED_GROUP` expenses (package costs). |
| **Status Beacon** | One-tap group communication (Ahead, Behind, Resting, Emergency) saved to cloud. |
| **Treat Pot** | Persistent savings bucket for final-day group rewards. |
| **WhatsApp Sync** | One-click text-format ledger export for group communication. |
| **Sync Token** | Base64 state backup for manual data recovery if the device is lost/swapped. |

## 4. Technical Stack
* **Frontend:** React (Vite), Tailwind CSS (CDN), GSAP (CDN).
* **Backend:** Supabase (PostgreSQL).
* **Database Tables:** * `expenses`: Individual spend logs, categories, and split logic.
    * `trip_state`: Global application state (Treat Pot, Status Beacon).
* **Deployment:** Vercel (Production-ready).

## 5. Functional Requirements
### 5.1 Expense Management
* Expenses must support: `amount`, `description`, `category`, `payer`, `split_between`, `type`, and `timestamp`.
* The `type` field must distinguish between standard (`expense`) and group-fixed (`Fixed-Package`) entries.

### 5.2 Real-time Sync Logic
* All UI components must subscribe to `postgres_changes` via `supabase.channel()`.
* The UI must reflect updates instantly without requiring a page refresh.

### 5.3 UX/UI Standards
* **Aesthetic:** Neutral, professional (Apple/Stripe-inspired).
* **Motion:** Micro-interactions (GSAP) for state changes and traffic light transitions.
* **Layout:** Mobile-first, whitespace-optimized.

## 6. Security & Access
* **RLS Policies:** Public access for the trek duration (anonymous access to speed up group deployment).
* **Treasurer Privilege:** Client-side conditional rendering protecting the Treasurer's logging UI.

## 7. Roadmap
1. **Phase 1 (Database):** SQL Schema initialization and Realtime publication setup.
2. **Phase 2 (Integration):** Implement Supabase client logic and replace `localStorage` CRUD.
3. **Phase 3 (Dashboard):** Implement GSAP Burn Rate logic, Status Beacon, and Treasurer UI.
4. **Phase 4 (Deployment):** Vercel build configuration and live-link testing.
