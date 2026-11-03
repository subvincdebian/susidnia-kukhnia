import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Не знайдено контейнер застосунку");
createRoot(root).render(<App />);
