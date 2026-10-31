import { mount } from "svelte";
import "../../src/article.css";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
