/** A response may commit only while its request is the latest one. */
export class LatestRequest {
  private generation = 0

  begin() {
    const generation = ++this.generation
    return () => generation === this.generation
  }

  invalidate() {
    this.generation += 1
  }
}
