import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider, isRouteErrorResponse, useRouteError } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { TargetDetail } from "./pages/TargetDetail";
import { TargetForm } from "./pages/TargetForm";
import { Targets } from "./pages/Targets";
import "./styles.css";

function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to the dashboard</Link>
      </p>
    </>
  );
}

function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : "Unknown error";
  return (
    <>
      <h1>Something went wrong</h1>
      <p className="note note-error" role="alert">
        {message}
      </p>
      <p>
        <Link to="/">Back to the dashboard</Link>
      </p>
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: (
      <Layout>
        <RouteError />
      </Layout>
    ),
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/targets", element: <Targets /> },
      { path: "/targets/new", element: <TargetForm /> },
      { path: "/targets/:id/edit", element: <TargetForm /> },
      { path: "/targets/:id", element: <TargetDetail /> },
      { path: "/settings", element: <Settings /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(<RouterProvider router={router} />);
