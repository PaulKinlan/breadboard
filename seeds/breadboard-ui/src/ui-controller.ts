/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input, type InputArgs } from "./input.js";
import { Load, type LoadArgs } from "./load.js";
import { Output, type OutputArgs } from "./output.js";
import { ResultArgs } from "./result.js";
import { DelayEvent, StartEvent, type ToastType } from "./events.js";
import { Toast } from "./toast.js";
import { InputContainer } from "./input-container.js";
import { Diagram } from "./diagram.js";
import {
  assertHTMLElement,
  assertRoot,
  assertSelectElement,
} from "./utils/assertions.js";
import { HarnessEventType } from "./types.js";
import { HistoryEntry } from "./history-entry.js";

export interface UI {
  progress(id: string, message: string): void;
  output(values: OutputArgs): void;
  input(id: string, args: InputArgs): Promise<Record<string, unknown>>;
  error(message: string): void;
  done(): void;
}

interface HistoryLogItem {
  type: string;
  summary: string;
  id: string | null;
  data: unknown | null;
  elapsedTime: number;
}

export class UIController extends HTMLElement implements UI {
  #inputContainer = new InputContainer();
  #progressContainer: HTMLElement;
  #currentBoardDiagram = "";
  #diagram = new Diagram();
  #lastHistoryEventTime = Number.NaN;
  #historyLog: HistoryLogItem[] = [];

  constructor() {
    super();

    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          padding: calc(var(--bb-grid-size) * 4) calc(var(--bb-grid-size) * 8)
              calc(var(--bb-grid-size) * 8) calc(var(--bb-grid-size) * 8);
          box-sizing: border-box;
          overflow: hidden;
        }

        :host * {
          box-sizing: border-box;
        }

        #wrapper {
          border-radius: calc(var(--bb-grid-size) * 9);
          border: 2px solid #E3E7ED;
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-columns: 65fr 35fr;
          overflow: hidden;
        }

        #diagram {
          border-radius: calc(var(--bb-grid-size) * 9);
          overflow: hidden;
          outline: 2px solid #E3E7ED;
          display: none;
          position: relative;
        }

        #diagram.active {
          display: block;
        }

        :host(.paused) #diagram::after {
          height: calc(var(--bb-grid-size) * 8);
          line-height: calc(var(--bb-grid-size) * 8);
          text-align: center;
          background: rgb(255, 242, 204);
          border-bottom: 1px solid rgb(255, 195, 115);
          content: 'This board is paused';
          position: absolute;
          width: 100%;
          top: 0;
          left: 0;
          font-size: var(--bb-text-small);
        }

        #diagram-container {
          width: 100%;
          height: 100%;
          overflow: auto;
        }

        #intro {
          display: none;
          grid-column: 1/3;
          background: rgb(244, 247, 252);
          border-radius: calc(var(--bb-grid-size) * 9);
          padding: calc(var(--bb-grid-size) * 8);
        }

        #intro > #contents {
          max-width: 600px;
        }

        #intro p {
          line-height: 1.5;
        }

        #intro.active {
          display: block;
        }

        #sidebar {
          display: none;
        }

        #sidebar.active {
          display: grid;
          grid-template-rows: calc(var(--bb-grid-size) * 14) auto;
          height: 100%;
          overflow: hidden;
        }

        #controls {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: flex-end;
          border-bottom: 1px solid rgb(227, 231, 237);
          padding-right: calc(var(--bb-grid-size) * 6);
        }

        #history,
        #output,
        #input {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        #history, #input {
          border-bottom: 1px solid rgb(227, 231, 237);
        }

        #history h1,
        #output h1,
        #input h1 {
          font-size: var(--bb-text-medium);
          margin: calc(var(--bb-grid-size) * 2) calc(var(--bb-grid-size) * 2);
          font-weight: 400;
          padding: 0 0 0 calc(var(--bb-grid-size) * 8);
          line-height: calc(var(--bb-grid-size) * 6);
        }

        #history h1 {
          background: var(--bb-icon-history) 0 0 no-repeat;
          display: flex;
        }

        #history h1 span {
          flex: 1;
        }

        #output h1 {
          background: var(--bb-icon-output) 0 0 no-repeat;
        }

        #input h1 {
          background: var(--bb-icon-input) 0 0 no-repeat;
        }

        #history-list,
        #output-list,
        #input-list {
          scrollbar-gutter: stable;
          overflow-y: auto;
          flex: 1;
        }

        #input-list {
          border-top: 1px solid rgb(240, 240, 240);
        }

        #history-list:empty::before,
        #output-list:empty::before,
        #input-list:empty::before {
          font-size: var(--bb-text-small);
          padding: calc(var(--bb-grid-size) * 5);
          padding-left: calc(var(--bb-grid-size) * 3 - 1px);
        }

        #history-list:empty::before {
          content: 'No nodes have run yet';
        }

        #output-list:empty::before {
          content: 'No board outputs received yet';
        }

        #input-list:empty::before {
          content: 'No active board inputs';
        }

        #response-container > #intro > h1 {
          font-size: var(--bb-text-xx-large);
          margin: 0 0 calc(var(--bb-grid-size) * 6) 0;
          display: inline-block;
          background: linear-gradient(
            45deg,
            rgb(90, 64, 119),
            rgb(144, 68, 228)
          );
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        #response-container > #intro > p {
          max-width: calc(var(--bb-grid-size) * 125);
          margin: 0 0 calc(var(--bb-grid-size) * 5) 0;
          line-height: 1.5;
        }

        #response-container a {
          color: var(--bb-font-color);
          font-weight: 700;
        }

        #new-here {
          font-size: var(--bb-text-small);
        }

        #url-input-container {
          margin-top: calc(var(--bb-grid-size) * 10);
          position: relative;
        }

        #url-input {
          border-radius: calc(var(--bb-grid-size) * 10);
          background: rgb(255, 255, 255);
          height: calc(var(--bb-grid-size) * 12);
          padding: 0 calc(var(--bb-grid-size) * 10) 0 calc(var(--bb-grid-size) * 4);
          width: 100%;
          border: 1px solid rgb(209, 209, 209);
        }

        #url-submit {
          font-size: 0;
          width: calc(var(--bb-grid-size) * 8);
          height: calc(var(--bb-grid-size) * 8);
          position: absolute;
          right: calc(var(--bb-grid-size) * 2);
          top: calc(var(--bb-grid-size) * 2);
          border-radius: 50%;
          background: #FFF var(--bb-icon-start) center center no-repeat;
          border: none;
        }

        #delay {
          width: auto;
          max-width: calc(var(--bb-grid-size) * 50);
          padding: calc(var(--bb-grid-size) * 2) calc(var(--bb-grid-size) * 4);
          padding-left: 30px;
          border-radius: 30px;
          background: rgb(255, 255, 255) var(--bb-icon-delay) 5px 4px no-repeat;
          border: 1px solid rgb(200, 200, 200);
        }

        #download-history-log {
          font-size: var(--bb-text-nano);
          color: #888;
        }

        #progress-container:empty {
          display: none;
        }

        #progress-container {
          display: block;
          position: absolute;
          bottom: 20px;
          left: 20px;
          border-radius: calc(var(--bb-grid-size) * 6);
          background: rgb(255, 255, 255);
          padding: calc(var(--bb-grid-size) * 2);
          border: 1px solid rgb(204, 204, 204);
          box-shadow: 0 2px 3px 0 rgba(0,0,0,0.13),
            0 7px 9px 0 rgba(0,0,0,0.16);
        }
      </style>
      <!-- Load info -->
      <div id="load-container">
        <slot name="load"></slot>
      </div>

      <div id="wrapper">
        <!-- Intro -->
        <div id="intro">
          <div id="contents">
            <h1>Hello there!</h1>
            <p>This is the <strong>Breadboard Playground</strong> running in the browser. Here you can either try out one of the sample boards, or you can enter the URL for your own board below.</p>

            <p id="new-here">New here? Read more about the <a href="https://github.com/breadboard-ai/breadboard/tree/main">Breadboard project on Github</a>.</p>

            <form>
              <div id="url-input-container">
                <input required id="url-input" type="url" name="url" placeholder="Enter a Board URL" />
                <input id="url-submit" type="submit" />
              </div>
            </form>
          </div>
        </div>

        <!-- Diagram -->
        <div id="diagram">
          <div id="diagram-container"></div>
          <div id="progress-container"></div>
        </div>

        <!-- Sidebar -->
        <div id="sidebar">
          <div id="controls">
            <select id="delay">
              <option>No delay</option>
              <option>250ms delay</option>
              <option>500ms delay</option>
              <option>1000ms delay</option>
              <option>1500ms delay</option>
            </select>
          </div>
          <div id="history">
            <h1>
              <span>History</span>
              <a href="#" id="download-history-log" download="history-log.json">Download log</a>
            </h1>
            <div id="history-list"></div>
          </div>
          <div id="input">
            <h1>Input</h1>
            <div id="input-list">
              <slot></slot>
            </div>
          </div>
          <div id="output">
            <h1>Outputs</h1>
            <div id="output-list"></div>
          </div>
        </div>
      </div>
    `;

    const progressContainer = root.querySelector("#progress-container");
    assertHTMLElement(progressContainer);
    this.#progressContainer = progressContainer;

    this.appendChild(this.#inputContainer);

    const diagramContainer = root.querySelector("#diagram-container");
    const delay = root.querySelector("#delay");
    assertHTMLElement(diagramContainer);
    assertSelectElement(delay);

    diagramContainer.appendChild(this.#diagram);
    delay.addEventListener("change", () => {
      this.dispatchEvent(new DelayEvent(parseFloat(delay.value)));
    });

    const downloadLog = root.querySelector("#download-history-log");
    assertHTMLElement(downloadLog);
    downloadLog.addEventListener("click", () => {
      const currentLink = downloadLog.getAttribute("href");
      if (currentLink) {
        URL.revokeObjectURL(currentLink);
      }

      const contents = JSON.stringify(this.#historyLog, null, 2);
      const file = new Blob([contents], { type: "application/json" });
      downloadLog.setAttribute("download", `history-log-${Date.now()}.json`);
      downloadLog.setAttribute("href", URL.createObjectURL(file));
    });
  }

  toast(message: string, type: ToastType) {
    const toast = new Toast(message, type);
    document.body.appendChild(toast);
  }

  showPaused() {
    this.classList.add("paused");
  }

  hidePaused() {
    this.classList.remove("paused");
  }

  #clearBoardContents() {
    this.#clearProgressContainer();
    this.#inputContainer.clearContents();

    const root = this.shadowRoot;
    assertRoot(root);

    const children = Array.from(this.children);
    for (const child of children) {
      if (child.tagName === "HEADER" || child === this.#inputContainer) {
        continue;
      }
      child.remove();
    }

    const outputList = root.querySelectorAll(
      "#output-list > *, #history-list > *"
    );
    for (const child of Array.from(outputList)) {
      child.remove();
    }
  }

  showIntroContent() {
    const root = this.shadowRoot;
    if (!root) {
      throw new Error("Unable to locate shadow root in UI Controller");
    }

    root.querySelector("#intro")?.classList.add("active");

    const form = root.querySelector("form");
    form?.addEventListener("submit", (evt: Event) => {
      evt.preventDefault();
      const data = new FormData(form);
      const url = data.get("url");
      if (!url) {
        throw new Error("Unable to located url in form data");
      }

      this.dispatchEvent(new StartEvent(url.toString()));
    });
  }

  #hideIntroContent() {
    const root = this.shadowRoot;
    if (!root) {
      throw new Error("Unable to locate shadow root in UI Controller");
    }

    root.querySelector("#intro")?.classList.remove("active");
  }

  #showBoardContainer() {
    const root = this.shadowRoot;
    if (!root) {
      throw new Error("Unable to locate shadow root in UI Controller");
    }

    root.querySelector("#sidebar")?.classList.add("active");
    root.querySelector("#diagram")?.classList.add("active");
  }

  #createHistoryEntry(
    type: HarnessEventType,
    summary: string,
    id: string | null = null,
    data: unknown | null = null
  ) {
    if (Number.isNaN(this.#lastHistoryEventTime)) {
      this.#lastHistoryEventTime = globalThis.performance.now();
    }

    const root = this.shadowRoot;
    assertRoot(root);

    const historyList = root.querySelector("#history-list");
    assertHTMLElement(historyList);

    const elapsedTime =
      globalThis.performance.now() - this.#lastHistoryEventTime;
    this.#lastHistoryEventTime = globalThis.performance.now();

    const historyEntry = new HistoryEntry(type, summary, id, data, elapsedTime);
    this.#historyLog.push({ type, summary, id, data, elapsedTime });

    if (historyList.childNodes.length) {
      historyList.insertBefore(historyEntry, historyList.firstChild);
    } else {
      historyList.appendChild(historyEntry);
    }
  }

  #clearProgressContainer() {
    const children = Array.from(this.#progressContainer.querySelectorAll("*"));
    for (const child of children) {
      child.remove();
    }
  }

  load(info: LoadArgs) {
    this.#currentBoardDiagram = info.diagram || "";

    this.#hideIntroContent();
    this.#clearBoardContents();
    this.#showBoardContainer();

    const load = new Load(info);
    load.slot = "load";
    this.appendChild(load);
    this.#diagram.reset();

    this.#historyLog.length = 0;
    this.#lastHistoryEventTime = globalThis.performance.now();
    this.#createHistoryEntry(
      HarnessEventType.LOAD,
      "Board loaded",
      undefined,
      info.url
    );
  }

  async renderDiagram(highlightNode = "") {
    if (!this.#currentBoardDiagram) {
      return;
    }

    return this.#diagram.render(this.#currentBoardDiagram, highlightNode);
  }

  progress(id: string, message: string) {
    this.#createHistoryEntry(HarnessEventType.PROGRESS, message, id);
  }

  async output(values: OutputArgs) {
    this.#clearProgressContainer();
    this.#createHistoryEntry(
      HarnessEventType.OUTPUT,
      "Output",
      values.node.id,
      values.outputs
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const outputContainer = this.shadowRoot!.querySelector("#output-list");
    const output = new Output();
    outputContainer?.appendChild(output);

    await output.display(values.outputs);
  }

  async secret(id: string): Promise<string> {
    const input = new Input(
      id,
      {
        schema: {
          properties: {
            secret: {
              title: id,
              description: `Enter ${id}`,
              type: "string",
            },
          },
        },
      },
      { remember: true, secret: true }
    );

    if (this.#inputContainer.childNodes.length) {
      this.#inputContainer.insertBefore(input, this.#inputContainer.firstChild);
    } else {
      this.#inputContainer.appendChild(input);
    }

    const data = (await input.ask()) as Record<string, string>;
    input.remove();

    this.#createHistoryEntry(HarnessEventType.SECRETS, `secrets`, id);

    return data.secret;
  }

  proxyResult(type: HarnessEventType, id: string, data: unknown | null = null) {
    this.#createHistoryEntry(type, type, id, data);
  }

  result(value: ResultArgs, id = null) {
    this.#createHistoryEntry(
      HarnessEventType.RESULT,
      value.title,
      id,
      value.result || null
    );
  }

  async input(id: string, args: InputArgs): Promise<Record<string, unknown>> {
    this.#clearProgressContainer();

    const input = new Input(id, args);
    if (this.#inputContainer.childNodes.length) {
      this.#inputContainer.insertBefore(input, this.#inputContainer.firstChild);
    } else {
      this.#inputContainer.appendChild(input);
    }

    const response = (await input.ask()) as Record<string, unknown>;
    this.#createHistoryEntry(HarnessEventType.INPUT, "input", id, {
      args,
      response,
    });

    return response;
  }

  error(message: string) {
    this.#clearProgressContainer();
    this.#createHistoryEntry(HarnessEventType.ERROR, message);
  }

  done() {
    this.#clearProgressContainer();
    this.#createHistoryEntry(HarnessEventType.DONE, "Board finished");
  }
}
