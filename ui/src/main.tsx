import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { TargetForm } from "./pages/TargetForm";
import { Targets } from "./pages/Targets";
import "./styles.css";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/targets", element: <Targets /> },
      { path: "/targets/new", element: <TargetForm /> },
      { path: "/targets/:id/edit", element: <TargetForm /> },
    ],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(<RouterProvider router={router} />);
