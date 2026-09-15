import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from './api';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { ArrowLeft, Save, Send } from 'lucide-react';

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState<any>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (job?.logs?.length > 0) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [job?.logs]);

  useEffect(() => {
    const fetchJob = async () => {
      try {
        const res = await api.get(`/jobs/${id}`);
        setJob(res.data);
        if (res.data.document && !content) {
          setContent(res.data.document.content);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchJob();
    const interval = setInterval(fetchJob, 5000);
    return () => clearInterval(interval);
  }, [id]);

  const handleSave = async (status: string) => {
    setSaving(true);
    try {
      await api.put(`/jobs/${id}/document`, { content, status });
      alert(`Document ${status.toLowerCase()} successfully!`);
    } catch (err) {
      console.error(err);
      alert('Failed to save document');
    }
    setSaving(false);
  };

  if (!job) return <div className="text-center py-10">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/dashboard" className="text-gray-500 hover:text-gray-900">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <h2 className="text-2xl font-bold text-gray-900">Job #{job.id} Details</h2>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          job.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
          job.status === 'FAILED' ? 'bg-red-100 text-red-800' :
          'bg-blue-100 text-blue-800'
        }`}>
          {job.status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-lg font-medium mb-2">Original Prompt</h3>
            <p className="text-gray-700 text-sm">{job.prompt}</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 h-[600px] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">Agent Execution Logs</h3>
              {job.status === 'IN_PROGRESS' && (
                <span className="flex items-center text-sm text-blue-600">
                  <span className="relative flex h-3 w-3 mr-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                  </span>
                  Working...
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto space-y-4">
              {job.logs.length === 0 ? (
                <p className="text-gray-500 text-sm">No logs yet...</p>
              ) : (
                job.logs.map((log: any, idx: number) => (
                  <div key={idx} className="border-l-4 border-blue-500 pl-4 py-2 bg-gray-50 rounded-r-md">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold text-sm text-gray-900">{log.agent}</span>
                      <span className="text-xs text-gray-500">{new Date(log.created_at).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-xs font-medium text-blue-600 mb-1">{log.action}</div>
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
                      {log.payload}
                    </pre>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col h-[750px]">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h3 className="text-lg font-medium">Generated Document Editor</h3>
              {job.document && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSave('DRAFT')}
                    disabled={saving}
                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <Save className="w-4 h-4 mr-1" />
                    Save Draft
                  </button>
                  <button
                    onClick={() => handleSave('APPROVED')}
                    disabled={saving}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-sm font-medium rounded text-white bg-green-600 hover:bg-green-700"
                  >
                    <Send className="w-4 h-4 mr-1" />
                    Approve & Dispatch
                  </button>
                </div>
              )}
            </div>
            
            <div className="flex-1 overflow-hidden p-4">
              {job.document ? (
                <div className="h-full">
                  <ReactQuill 
                    theme="snow" 
                    value={content} 
                    onChange={setContent} 
                    className="h-[600px] mb-12"
                    modules={{
                      toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        [{ 'color': [] }, { 'background': [] }],
                        ['link', 'image'],
                        ['clean']
                      ],
                    }}
                  />
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
                  {job.status === 'IN_PROGRESS' && (
                    <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
                  )}
                  <p>{job.status === 'COMPLETED' ? 'No document generated.' : 'Waiting for agents to finish processing...'}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
