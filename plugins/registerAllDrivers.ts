/**
 * Auto-register ทุก Driver — import ไฟล์นี้ครั้งเดียว
 * รวม: Driver registration + Workflow engine ready
 *
 * Moved out of core/executor/init.ts (Phase 2.3A) — core must not import
 * concrete plugin drivers directly (registry/dependency-graph.json:
 * allowed_imports.core = ["registry"]). plugins -> core is already an
 * allowed edge, so the registration list lives here instead.
 */
import { register } from "@/core/executor/registry";
import "@/core/executor/init"; // ensure workflow engine module is loaded
import line from "@/plugins/drivers/line";
import chrome from "@/plugins/drivers/chrome";
import vscode from "@/plugins/drivers/vscode";
import finder from "@/plugins/drivers/finder";
import terminal from "@/plugins/drivers/terminal";
import maps from "@/plugins/drivers/maps";
import earth from "@/plugins/drivers/earth";
import mail from "@/plugins/drivers/mail";
import calendar from "@/plugins/drivers/calendar";
import pdf from "@/plugins/drivers/pdf";
import github from "@/plugins/drivers/github";

[line, chrome, vscode, finder, terminal, maps, earth, mail, calendar, pdf, github].forEach(register);
