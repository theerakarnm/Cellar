import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";

export function Layout({ children }: { children?: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand">
          Cellar
        </NavLink>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/targets">Targets</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main className="page">
        {children ?? <Outlet />}
      </main>
    </>
  );
}
