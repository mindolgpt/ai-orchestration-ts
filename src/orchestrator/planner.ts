import { DAG, createDAG, createTaskNode } from '@/dag'
import chalk from 'chalk'

export interface Plan {
  title: string
  description: string
  successCriteria: string[]
  constraints: string[]
  dag?: DAG
  estimatedLayers: number
}

export class DeepInterviewPlanner {
  private plans: Plan[] = []

  createPlan(
    title: string,
    description: string,
    successCriteria: string[] = [],
    constraints: string[] = []
  ): Plan {
    const plan: Plan = { title, description, successCriteria, constraints, estimatedLayers: 0 }
    this.plans.push(plan)
    return plan
  }

  decomposeToDAG(plan: Plan, tasks: Array<[string, string, string[]]>): DAG {
    const dag = createDAG()
    for (const [id, label, deps] of tasks) {
      dag.addNode(createTaskNode(id, label, undefined, deps))
    }
    plan.dag = dag
    plan.estimatedLayers = Object.keys(dag.computeLayers()).length
    return dag
  }

  printPlan(plan: Plan): void {
    console.log(chalk.bold.cyan(`\n📋 ${plan.title}`))
    console.log(plan.description)
    if (plan.successCriteria.length) {
      console.log(chalk.bold('\n성공 기준:'))
      plan.successCriteria.forEach((c) => console.log(`  ✓ ${c}`))
    }
    if (plan.constraints.length) {
      console.log(chalk.bold('\n제약 조건:'))
      plan.constraints.forEach((c) => console.log(`  ⚠ ${c}`))
    }
    if (plan.dag) {
      console.log(plan.dag.summary())
    }
  }

  getPlans(): Plan[] {
    return this.plans
  }
}

export function createPlanner(): DeepInterviewPlanner {
  return new DeepInterviewPlanner()
}
