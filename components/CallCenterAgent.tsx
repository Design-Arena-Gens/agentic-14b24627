"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentContext,
  AgentReply,
  evaluateCustomerMessage
} from "@/lib/agent";
import { getSampleOrders, OrderRecord } from "@/lib/orders";

type ConversationAuthor = "customer" | "agent" | "system";

interface ConversationEntry {
  id: string;
  author: ConversationAuthor;
  text: string;
  timestamp: number;
}

type CallState = "idle" | "connecting" | "active" | "ended";

const orders = getSampleOrders();

const createMessage = (author: ConversationAuthor, text: string): ConversationEntry => ({
  id:
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10),
  author,
  text,
  timestamp: Date.now()
});

const formatTimestamp = (value: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "numeric"
  }).format(new Date(value));

const speak = (message: string) => {
  if (typeof window === "undefined") return;
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = "en-US";
  utterance.rate = 1.02;
  utterance.pitch = 1.03;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
};

const CallStatusBadge = ({ status }: { status: CallState }) => {
  const labelMap: Record<CallState, string> = {
    idle: "Idle",
    connecting: "Connecting",
    active: "On Call",
    ended: "Call Ended"
  };
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" />
      {labelMap[status]}
    </span>
  );
};

const OrderCard = ({ order }: { order: OrderRecord }) => (
  <div className="order-card">
    <header>
      <span className="order-id">{order.id}</span>
      <span className={`order-status order-status-${order.status}`}>{order.status}</span>
    </header>
    <div className="order-meta">
      <span>{order.customerName}</span>
      <span>{new Date(order.placedOn).toLocaleDateString()}</span>
    </div>
    <ul className="order-items">
      {order.items.map((item) => (
        <li key={`${order.id}-${item.sku}`}>
          <strong>{item.name}</strong>
          <span>×{item.quantity}</span>
        </li>
      ))}
    </ul>
    {order.eta && (
      <p className="order-eta">
        ETA <strong>{order.eta}</strong>
      </p>
    )}
    {order.notes && <p className="order-notes">{order.notes}</p>}
  </div>
);

const ConversationBubble = ({ entry }: { entry: ConversationEntry }) => (
  <div className={`bubble bubble-${entry.author}`}>
    <div className="bubble-meta">
      <span className="bubble-author">
        {entry.author === "customer"
          ? "Customer"
          : entry.author === "agent"
            ? "Aurora Agent"
            : "System"}
      </span>
      <span className="bubble-time">{formatTimestamp(entry.timestamp)}</span>
    </div>
    <p>{entry.text}</p>
  </div>
);

export default function CallCenterAgent() {
  const [callStatus, setCallStatus] = useState<CallState>("idle");
  const [conversation, setConversation] = useState<ConversationEntry[]>(() => [
    createMessage(
      "system",
      "You are connected to Aurora Collective's virtual concierge. Tap start to launch a live support call."
    )
  ]);
  const [agentContext, setAgentContext] = useState<AgentContext>({
    escalationRequested: false
  });
  const [partialTranscript, setPartialTranscript] = useState("");
  const [inputDraft, setInputDraft] = useState("");
  const [canUseSpeech, setCanUseSpeech] = useState(false);
  const [followUpPrompts, setFollowUpPrompts] = useState<string[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const contextRef = useRef<AgentContext>(agentContext);

  useEffect(() => {
    contextRef.current = agentContext;
  }, [agentContext]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    setCanUseSpeech(Boolean(SpeechRecognitionCtor));
  }, []);

  const stopRecognition = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const teardownCall = useCallback(() => {
    stopRecognition();
    stopMediaStream();
  }, [stopRecognition, stopMediaStream]);

  useEffect(() => {
    return () => {
      teardownCall();
    };
  }, [teardownCall]);

  const appendMessage = useCallback((author: ConversationAuthor, text: string) => {
    setConversation((prev) => [...prev, createMessage(author, text)]);
  }, []);

  const handleAgentReply = useCallback(
    (reply: AgentReply) => {
      appendMessage("agent", reply.message);
      if (reply.followUpPrompts) {
        setFollowUpPrompts(reply.followUpPrompts);
      } else {
        setFollowUpPrompts([]);
      }
      setAgentContext(reply.updatedContext);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        speak(reply.message);
      }
    },
    [appendMessage]
  );

  const processCustomerMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      appendMessage("customer", trimmed);
      const reply = evaluateCustomerMessage(trimmed, contextRef.current);
      handleAgentReply(reply);
    },
    [appendMessage, handleAgentReply]
  );

  const buildSpeechRecognition = useCallback(() => {
    if (typeof window === "undefined") return null;
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return null;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          processCustomerMessage(transcript);
        } else {
          interim += transcript;
        }
      }
      setPartialTranscript(interim);
    };

    recognition.onerror = () => {
      setPartialTranscript("");
      appendMessage(
        "system",
        "We encountered an issue with voice recognition. You can continue by typing below."
      );
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setPartialTranscript("");
      if (callStatus === "active") {
        const freshInstance = buildSpeechRecognition();
        recognitionRef.current = freshInstance;
        freshInstance?.start();
      }
    };

    return recognition;
  }, [appendMessage, callStatus, processCustomerMessage]);

  const startCall = useCallback(async () => {
    if (callStatus === "active") return;
    setCallStatus("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setCallStatus("active");
      appendMessage("agent", "Hi there! You're connected to Aurora Collective. How can I help today?");
      if (canUseSpeech) {
        const recognition = buildSpeechRecognition();
        recognitionRef.current = recognition;
        recognition?.start();
      }
    } catch (error) {
      console.error(error);
      appendMessage(
        "system",
        "We couldn't access the microphone. Please check your browser permissions."
      );
      setCallStatus("idle");
    }
  }, [appendMessage, buildSpeechRecognition, callStatus, canUseSpeech]);

  const endCall = useCallback(() => {
    if (callStatus === "idle") return;
    setCallStatus("ended");
    teardownCall();
    appendMessage("agent", "Thank you for contacting Aurora Collective. Goodbye!");
  }, [appendMessage, callStatus, teardownCall]);

  const resetCall = useCallback(() => {
    teardownCall();
    setCallStatus("idle");
    setConversation([
      createMessage(
        "system",
        "You are connected to Aurora Collective's virtual concierge. Tap start to launch a live support call."
      )
    ]);
    setAgentContext({ escalationRequested: false });
    setFollowUpPrompts([]);
    setPartialTranscript("");
  }, [teardownCall]);

  const submitDraft = useCallback(
    (event?: React.FormEvent) => {
      if (event) event.preventDefault();
      const payload = inputDraft.trim();
      if (!payload) return;
      setInputDraft("");
      processCustomerMessage(payload);
    },
    [inputDraft, processCustomerMessage]
  );

  const escalationNotice = useMemo(
    () =>
      agentContext.escalationRequested
        ? "Live escalation requested. Routing to specialist..."
        : null,
    [agentContext.escalationRequested]
  );

  return (
    <main className="page">
      <section className="hero">
        <div>
          <h1>Real-time Voice Concierge for Aurora Collective</h1>
          <p>
            Manage customer calls with an AI agent that understands order history, shipping status, and
            post-purchase support workflows.
          </p>
          <div className="controls">
            <button
              className="btn btn-primary"
              onClick={startCall}
              disabled={callStatus === "connecting" || callStatus === "active"}
            >
              {callStatus === "active" ? "Call in Progress" : "Start Call"}
            </button>
            <button className="btn" onClick={endCall} disabled={callStatus !== "active"}>
              End Call
            </button>
            <button className="btn btn-tertiary" onClick={resetCall}>
              Reset
            </button>
            <CallStatusBadge status={callStatus} />
          </div>
          {escalationNotice && <p className="escalation">{escalationNotice}</p>}
          {!canUseSpeech && (
            <p className="warning">
              Voice recognition is not supported in this browser. You can still interact using the message field
              below.
            </p>
          )}
        </div>
      </section>

      <section className="workspace">
        <div className="conversation">
          <header className="conversation-header">
            <h2>Live Conversation</h2>
            {partialTranscript && (
              <span className="transcript-live">Listening… {partialTranscript}</span>
            )}
          </header>

          <div className="conversation-feed">
            {conversation.map((entry) => (
              <ConversationBubble entry={entry} key={entry.id} />
            ))}
          </div>

          {followUpPrompts.length > 0 && (
            <div className="follow-ups">
              <h3>Suggested Follow-ups</h3>
              <ul>
                {followUpPrompts.map((prompt, index) => (
                  <li key={`${prompt}-${index}`}>{prompt}</li>
                ))}
              </ul>
            </div>
          )}

          <form className="composer" onSubmit={submitDraft}>
            <label htmlFor="message">Type a response</label>
            <div className="composer-row">
              <input
                id="message"
                name="message"
                placeholder="Ask about an order, returns, or product recommendations…"
                value={inputDraft}
                onChange={(event) => setInputDraft(event.target.value)}
              />
              <button type="submit" className="btn btn-primary">
                Send
              </button>
            </div>
          </form>
        </div>

        <aside className="sidebar">
          <div className="sidebar-card">
            <h2>Recent Orders</h2>
            <div className="orders-grid">
              {orders.map((order) => (
                <OrderCard order={order} key={order.id} />
              ))}
            </div>
          </div>

          <div className="sidebar-card">
            <h2>Playbook</h2>
            <ul className="playbook">
              <li>Confirm caller identity and order number</li>
              <li>Provide proactive shipment ETAs and tracking</li>
              <li>Offer curated upsells aligned with purchase history</li>
              <li>Escalate to a human when policy exceptions arise</li>
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}
