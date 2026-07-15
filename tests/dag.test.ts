/// <reference types="vitest/globals" />
import { DAG, createDAG, createTaskNode, TaskNode } from "../src/dag";

describe("DAG", () => {
  test("add nodes and edges", () => {
    const dag = createDAG();
    dag.addNode(createTaskNode("A", "Task A"));
    dag.addNode(createTaskNode("B", "Task B", undefined, ["A"]));
    expect(dag.nodes.size).toBe(2);
  });

  test("cycle detection", () => {
    const dag = createDAG();
    dag.addNode(createTaskNode("A", "A", undefined, ["C"]));
    dag.addNode(createTaskNode("B", "B", undefined, ["A"]));
    dag.addNode(createTaskNode("C", "C", undefined, ["B"]));
    const err = dag.validate();
    expect(err).not.toBeNull();
    expect(err).toContain("Cycle");
  });

  test("missing dependency", () => {
    const dag = createDAG();
    dag.addNode(createTaskNode("A", "A", undefined, ["MISSING"]));
    const err = dag.validate();
    expect(err).not.toBeNull();
    expect(err).toContain("MISSING");
  });

  test("layer computation", () => {
    const dag = createDAG();
    dag.addNode(createTaskNode("A", "A"));
    dag.addNode(createTaskNode("B", "B", undefined, ["A"]));
    dag.addNode(createTaskNode("C", "C", undefined, ["A"]));
    dag.addNode(createTaskNode("D", "D", undefined, ["B", "C"]));
    const layers = dag.computeLayers();
    expect(layers[0][0].id).toBe("A");
    expect(new Set(layers[1].map(n => n.id))).toEqual(new Set(["B", "C"]));
    expect(layers[2][0].id).toBe("D");
  });
});