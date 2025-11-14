export default function Dashboard() {
  return (
    <div className="rounded-xl bg-white p-6 shadow">
      <h2 className="text-lg font-semibold">Dashboard</h2>
      <p className="text-sm text-gray-600 mt-2">Student progress, usage, and quick actions will appear here.</p>
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat title="Active Sessions" value="—" />
        <Stat title="Total Requests" value="—" />
        <Stat title="Quizzes Generated" value="—" />
      </div>
    </div>
  );
}

function Stat({ title, value }) {
  return (
    <div className="rounded-lg p-4 border">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-bold mt-2">{value}</div>
    </div>
  );
}
