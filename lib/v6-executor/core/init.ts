/**
 * Auto-register ทุก Driver — import ไฟล์นี้ครั้งเดียว
 */
import { register } from "./registry";
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
