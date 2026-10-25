/**
 * Resource Graph — เชื่อมความสัมพันธ์ระหว่าง Entity
 *
 * Pure Function
 */

import type { Entity, ResourceEdge, ResourceGraph, RelationType } from "./types";

export function buildResourceGraph(entities: Entity[]): ResourceGraph {
  const edges: ResourceEdge[] = [];

  const customers = entities.filter(e => e.type === "customer");
  const debts = entities.filter(e => e.type === "debt");
  const documents = entities.filter(e => e.type === "document");
  const jobs = entities.filter(e => e.type === "job");
  const partners = entities.filter(e => e.type === "partner");
  const materials = entities.filter(e => e.type === "material");

  // customer → debt (owes)
  for (const customer of customers) {
    for (const debt of debts) {
      const debtCustomer = debt.attributes.customer_name ?? debt.name;
      if (typeof debtCustomer === "string" && customer.name.includes(debtCustomer)) {
        edges.push({ from: customer.id, to: debt.id, relation: "owes" });
      }
    }
  }

  // customer → document (refers_to)
  for (const customer of customers) {
    for (const doc of documents) {
      if (doc.attributes.party_name === customer.name) {
        edges.push({ from: customer.id, to: doc.id, relation: "refers_to" });
      }
    }
  }

  // customer → job (owns)
  for (const customer of customers) {
    for (const job of jobs) {
      if (job.attributes.contact === customer.name) {
        edges.push({ from: customer.id, to: job.id, relation: "owns" });
      }
    }
  }

  // partner → material (supplies)
  for (const partner of partners) {
    for (const material of materials) {
      edges.push({ from: partner.id, to: material.id, relation: "supplies" });
    }
  }

  // job → material (part_of)
  for (const job of jobs) {
    for (const material of materials) {
      edges.push({ from: job.id, to: material.id, relation: "part_of" });
    }
  }

  return { entities, edges };
}
