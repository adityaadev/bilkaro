# Bilkaro

## Run locally

1. Ensure `.env.local` contains `DATABASE_URL` and `JWT_SECRET`.
2. Run `npm run dev`.
3. Open the Vite address printed in the terminal (normally `http://localhost:5173`).

`npm run dev` starts both the Vite frontend and the API server on port 4000. The API is required for saving customers, products, expenses, invoices, and payments.

For a production-style local run, build the frontend with `npm run build`, then use `npm start`.
