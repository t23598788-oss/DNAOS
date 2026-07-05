/**
 * Auto-register ทุก Driver — import ไฟล์นี้ครั้งเดียว
 * รวม: Driver registration + Workflow engine ready
 */
import { register } from "./registry";
import "@/lib/v6-executor/core/engine"; // ensure workflow engine module is loaded
import line from "@/lib/v6-executor/drivers/line";
import chrome from "@/lib/v6-executor/drivers/chrome";
import vscode from "@/lib/v6-executor/drivers/vscode";
import finder from "@/lib/v6-executor/drivers/finder";
import terminal from "@/lib/v6-executor/drivers/terminal";
import maps from "@/lib/v6-executor/drivers/maps";
import earth from "@/lib/v6-executor/drivers/earth";
import mail from "@/lib/v6-executor/drivers/mail";
import calendar from "@/lib/v6-executor/drivers/calendar";
import pdf from "@/lib/v6-executor/drivers/pdf";
import github from "@/lib/v6-executor/drivers/github";

[line, chrome, vscode, finder, terminal, maps, earth, mail, calendar, pdf, github].forEach(register);
