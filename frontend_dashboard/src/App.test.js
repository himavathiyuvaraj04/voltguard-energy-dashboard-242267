import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders VoltGuard dashboard demo mode badge", () => {
  render(<App />);
  expect(screen.getByText(/VoltGuard/i)).toBeInTheDocument();
  expect(screen.getByText(/Demo Mode/i)).toBeInTheDocument();
});
