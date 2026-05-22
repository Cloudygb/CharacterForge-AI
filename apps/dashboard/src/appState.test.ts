import { describe, expect, it } from "vitest";

import {
  buildDeploymentConfig,
  buildSharedDashboardState,
  getDashboardReadiness,
  getWelcomeEmptyState,
  isApiConnected,
  isDeploymentRunning,
  toApiConnectionStatus,
  toCharacterRecord,
  toDeploymentStatus,
  type ApiConnectionStatus,
  type CharacterFolderStatus,
  type DeploymentStatus
} from "./appState";

describe("shared dashboard app state", () => {
  it("builds deployment config without treating blank API settings as configured", () => {
    const config = buildDeploymentConfig({
      apiBaseUrl: "   ",
      awsRegion: " us-east-1 ",
      bedrockModel: " anthropic.claude-3-haiku-20240307-v1:0 ",
      profileName: " default ",
      stackName: " characterforge-demo "
    });

    expect(config).toEqual({
      apiBaseUrl: "",
      awsRegion: "us-east-1",
      bedrockModel: "anthropic.claude-3-haiku-20240307-v1:0",
      profileName: "default",
      stackName: "characterforge-demo"
    });
  });

  it("distinguishes not configured, configured, connected, running, and failed readiness states", () => {
    const folder: CharacterFolderStatus = { state: "ready", path: "C:/Characters", message: "Folder ready" };
    const notConfigured = buildSharedDashboardState({
      apiConnection: { state: "not_configured", apiBaseUrl: "", message: "No API configured" },
      deployment: { phase: "not_configured", message: "No stack configured" },
      characters: [],
      characterFolder: folder
    });

    expect(getDashboardReadiness(notConfigured)).toMatchObject({
      canLoadCharacters: false,
      canChat: false,
      needsDeploymentSetup: true,
      hasCharacters: false,
      welcomeTone: "empty"
    });
    expect(getWelcomeEmptyState(notConfigured)).toContain("No AWS backend connected yet");

    const configured = buildSharedDashboardState({
      apiConnection: { state: "configured", apiBaseUrl: "https://<api-id>.execute-api.<region>.amazonaws.com/<stage>", message: "Ready to test" },
      deployment: { phase: "configured", stackStatus: "CREATE_COMPLETE", message: "Stack configured" },
      characters: [],
      characterFolder: folder
    });

    expect(getDashboardReadiness(configured)).toMatchObject({
      canLoadCharacters: false,
      canChat: false,
      needsDeploymentSetup: false,
      welcomeTone: "needs_connection"
    });

    const connected = buildSharedDashboardState({
      apiConnection: { state: "connected", apiBaseUrl: "https://<api-id>.execute-api.<region>.amazonaws.com/<stage>", message: "Connected" },
      deployment: { phase: "running", stackStatus: "CREATE_COMPLETE", message: "Stack running" },
      characters: [
        toCharacterRecord({
          id: "mira",
          name: "Captain Mira Voss",
          description: "Airship captain",
          actions: [{ id: "quest", name: "Give Quest", type: "give_quest", triggerInstructions: "Offer a lead" }]
        })
      ],
      selectedCharacterId: "mira",
      characterFolder: folder
    });

    expect(isApiConnected(connected.apiConnection)).toBe(true);
    expect(isDeploymentRunning(connected.deployment)).toBe(true);
    expect(getDashboardReadiness(connected)).toMatchObject({
      canLoadCharacters: true,
      canChat: true,
      hasCharacters: true,
      selectedCharacterReady: true,
      welcomeTone: "ready"
    });

    const failed: DeploymentStatus = { phase: "failed", stackStatus: "ROLLBACK_COMPLETE", message: "Rollback complete" };
    const api: ApiConnectionStatus = { state: "error", apiBaseUrl: "https://<api-id>.execute-api.<region>.amazonaws.com/<stage>", message: "Connection failed" };
    const failedState = buildSharedDashboardState({ apiConnection: api, deployment: failed, characters: [], characterFolder: folder });
    expect(getDashboardReadiness(failedState)).toMatchObject({
      canLoadCharacters: false,
      canChat: false,
      deploymentNeedsAttention: true,
      welcomeTone: "error"
    });
  });

  it("maps existing UI status values into shared connection and deployment states", () => {
    expect(toApiConnectionStatus({ apiBaseUrl: "", state: "mock", message: "Mock mode" })).toEqual({
      apiBaseUrl: "",
      message: "Mock mode",
      state: "not_configured"
    });
    expect(toApiConnectionStatus({ apiBaseUrl: "https://<api-id>.execute-api.<region>.amazonaws.com/<stage>", state: "success", message: "Connected" })).toMatchObject({
      state: "connected"
    });
    expect(toDeploymentStatus({ configured: true, state: "error", message: "Failed", stackStatus: "ROLLBACK_COMPLETE" })).toMatchObject({
      phase: "rollback",
      stackStatus: "ROLLBACK_COMPLETE"
    });
  });

  it("normalizes character records with custom actions and local sync status", () => {
    const record = toCharacterRecord({
      id: "thalen",
      name: "Ember Archivist Thalen",
      description: "A careful archivist",
      localFilePath: "C:/Characters/thalen.json",
      syncStatus: "local_only",
      actions: [
        {
          id: "catalog-memory",
          name: "Catalog Memory",
          type: "catalog_memory",
          triggerInstructions: "Use when Thalen learns a durable fact.",
          payloadTemplate: { memory_id: "", confidence: 0.8 }
        }
      ]
    });

    expect(record).toMatchObject({
      id: "thalen",
      displayName: "Ember Archivist Thalen",
      syncStatus: "local_only",
      localFilePath: "C:/Characters/thalen.json"
    });
    expect(record.actions).toEqual([
      {
        id: "catalog-memory",
        name: "Catalog Memory",
        type: "catalog_memory",
        triggerInstructions: "Use when Thalen learns a durable fact.",
        payloadTemplate: { memory_id: "", confidence: 0.8 },
        enabled: true
      }
    ]);
  });
});
