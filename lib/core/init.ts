/**
 * Auto-register ทุก Driver — import ไฟล์นี้ครั้งเดียว
 */
import { register } from "./registry";
import line from "@/lib/drivers/line";
import chrome from "@/lib/drivers/chrome";
import vscode from "@/lib/drivers/vscode";
import finder from "@/lib/drivers/finder";
import terminal from "@/lib/drivers/terminal";
import maps from "@/lib/drivers/maps";
import earth from "@/lib/drivers/earth";
import mail from "@/lib/drivers/mail";
import calendar from "@/lib/drivers/calendar";
import pdf from "@/lib/drivers/pdf";
import github from "@/lib/drivers/github";

[line, chrome, vscode, finder, terminal, maps, earth, mail, calendar, pdf, github].forEach(register);
